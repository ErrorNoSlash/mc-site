package be.errornoslash.dswhitelist;

import com.google.inject.Inject;
import com.velocitypowered.api.event.ResultedEvent;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.connection.LoginEvent;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.event.proxy.ProxyShutdownEvent;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.plugin.annotation.DataDirectory;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import com.velocitypowered.api.proxy.server.ServerInfo;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.minimessage.MiniMessage;
import net.kyori.adventure.text.minimessage.tag.resolver.TagResolver;
import net.kyori.adventure.text.minimessage.tag.standard.StandardTags;
import org.slf4j.Logger;

/*
 * Whitelist at the proxy, managed by the website's API.
 *
 * The API writes plugins/ds-whitelist/whitelist.txt; this plugin reads it (and re-reads it
 * within a few seconds of every change), turns away anyone not on it while it is enforced,
 * and kicks online players who were removed. Every login is noted in seen.tsv so the admin
 * page can list the people who already play here.
 *
 * Java players are matched by UUID (the proxy runs in online mode, so it is trustworthy).
 * Bedrock players are matched by their Floodgate name (".Gamertag"), because their UUID
 * comes from an Xbox id the website cannot look up reliably. Java names cannot contain a
 * dot, so a Java account can never pass as a Bedrock name.
 *
 * Worlds listed in archived.txt (written by mc-backup --archive on the server) are taken
 * off the proxy's server list while they are archived, and put back when they are not.
 *
 * Both files are read-only here and treated as untrusted: they are size-capped, a bad line
 * is skipped, and the kick message may only use colours and text styles (no click, hover,
 * insertion or other interactive tags).
 */
@Plugin(
        id = "ds-whitelist",
        name = "DS Whitelist",
        version = "1.0.0",
        description = "Whitelist managed by the server website",
        authors = {"Dias Stas"})
public final class DsWhitelistPlugin {

    // the kick message may only colour and style text
    private static final MiniMessage MINI_MESSAGE = MiniMessage.builder()
            .tags(TagResolver.builder()
                    .resolver(StandardTags.color())
                    .resolver(StandardTags.decorations())
                    .resolver(StandardTags.gradient())
                    .resolver(StandardTags.rainbow())
                    .resolver(StandardTags.reset())
                    .resolver(StandardTags.newline())
                    .build())
            .build();

    // bigger files than these are not something the API or mc-backup wrote: they are not read
    private static final long MAX_WHITELIST_BYTES = 2L * 1024 * 1024;
    private static final long MAX_ARCHIVED_BYTES = 64L * 1024;

    private final ProxyServer proxy;
    private final Logger logger;
    private final Path dataDirectory;
    private final Path whitelistFile;
    private final Path archivedFile;
    private final SeenLog seenLog;

    private volatile Whitelist whitelist = Whitelist.MISSING;
    private long loadedModified = Long.MIN_VALUE;
    private boolean warnedMissing;

    // archived worlds taken off the server list, kept so they can be put back
    private final Map<String, ServerInfo> hiddenServers = new HashMap<>();
    private long archivedModified = Long.MIN_VALUE;

    @Inject
    public DsWhitelistPlugin(ProxyServer proxy, Logger logger, @DataDirectory Path dataDirectory) {
        this.proxy = proxy;
        this.logger = logger;
        this.dataDirectory = dataDirectory;
        // where the files are can be set from the container (they are mounted read-only from elsewhere)
        this.whitelistFile = pathFromEnvironment("DS_WHITELIST_FILE", dataDirectory.resolve("whitelist.txt"));
        this.archivedFile = pathFromEnvironment("DS_ARCHIVED_FILE", dataDirectory.resolve("archived.txt"));
        this.seenLog = new SeenLog(dataDirectory.resolve("seen.tsv"));
    }

    private static Path pathFromEnvironment(String name, Path fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : Path.of(value);
    }

    @Subscribe
    public void onProxyInitialize(ProxyInitializeEvent event) {
        try {
            Files.createDirectories(dataDirectory);
            seenLog.load();
        } catch (IOException exception) {
            logger.warn("Could not prepare " + dataDirectory, exception);
        }
        reloadIfChanged();
        reloadArchivedIfChanged();
        proxy.getScheduler()
                .buildTask(this, this::tick)
                .delay(3, TimeUnit.SECONDS)
                .repeat(3, TimeUnit.SECONDS)
                .schedule();
    }

    @Subscribe
    public void onProxyShutdown(ProxyShutdownEvent event) {
        flushSeen();
    }

    @Subscribe
    public void onLogin(LoginEvent event) {
        if (!event.getResult().isAllowed()) {
            return;
        }
        reloadIfChanged();

        Player player = event.getPlayer();
        Whitelist current = whitelist;
        boolean blocked = current.blocks(player.getUniqueId(), player.getUsername());
        boolean listed = current.allows(player.getUniqueId(), player.getUsername());
        boolean turnedAway = blocked || (current.enforced() && !listed);

        seenLog.record(player.getUniqueId(), player.getUsername(), turnedAway);

        if (blocked) {
            event.setResult(ResultedEvent.ComponentResult.denied(message(current.blockMessage(), player)));
            logger.info("Turned away " + player.getUsername() + " (" + player.getUniqueId() + "): blacklisted");
        } else if (turnedAway) {
            event.setResult(ResultedEvent.ComponentResult.denied(kickMessage(current, player)));
            logger.info("Turned away " + player.getUsername() + " (" + player.getUniqueId() + "): not whitelisted");
        }
    }

    private void tick() {
        if (reloadIfChanged()) {
            kickRemovedPlayers();
        }
        reloadArchivedIfChanged();
        flushSeen();
    }

    /* Re-reads whitelist.txt when its modification time changed. Returns true if it did. */
    private synchronized boolean reloadIfChanged() {
        long modified;
        try {
            modified = Files.getLastModifiedTime(whitelistFile).toMillis();
        } catch (IOException missing) {
            if (!warnedMissing) {
                logger.warn(whitelistFile + " does not exist yet, so nobody is turned away. "
                        + "Start the whitelist API (it writes this file) to enable the whitelist.");
                warnedMissing = true;
            }
            boolean changed = whitelist != Whitelist.MISSING;
            whitelist = Whitelist.MISSING;
            loadedModified = Long.MIN_VALUE;
            return changed;
        }
        if (modified == loadedModified) {
            return false;
        }
        try {
            if (Files.size(whitelistFile) > MAX_WHITELIST_BYTES) {
                throw new IOException("bigger than " + MAX_WHITELIST_BYTES + " bytes");
            }
            Whitelist loaded = Whitelist.parse(Files.readAllLines(whitelistFile));
            whitelist = loaded;
            loadedModified = modified;
            warnedMissing = false;
            logger.info("Whitelist loaded: " + loaded.size() + " players, "
                    + (loaded.enforced() ? "enforced" : "NOT enforced (everyone can join)")
                    + (loaded.blockedSize() > 0 ? ", " + loaded.blockedSize() + " blacklisted" : ""));
            return true;
        } catch (IOException | RuntimeException exception) {
            // keep the last good list rather than letting everyone in or locking everyone out
            logger.error("Could not read " + whitelistFile + ", keeping the previous whitelist", exception);
            loadedModified = modified;
            return false;
        }
    }

    /* After a change: blacklisted players go always, players taken off the whitelist only while it is on */
    private void kickRemovedPlayers() {
        Whitelist current = whitelist;
        for (Player player : proxy.getAllPlayers()) {
            if (current.blocks(player.getUniqueId(), player.getUsername())) {
                player.disconnect(message(current.blockMessage(), player));
                logger.info("Kicked " + player.getUsername() + ": blacklisted");
            } else if (current.enforced() && !current.allows(player.getUniqueId(), player.getUsername())) {
                player.disconnect(kickMessage(current, player));
                logger.info("Kicked " + player.getUsername() + ": removed from the whitelist");
            }
        }
    }

    /* Re-reads archived.txt when it changed: archived worlds come off the server list, worlds
       that are no longer archived go back on. Only the first column (the world's name) is used. */
    private synchronized void reloadArchivedIfChanged() {
        long modified;
        try {
            modified = Files.getLastModifiedTime(archivedFile).toMillis();
        } catch (IOException missing) {
            modified = Long.MIN_VALUE + 1;
        }
        if (modified == archivedModified) {
            return;
        }
        archivedModified = modified;

        Set<String> archived = new HashSet<>();
        try {
            if (Files.exists(archivedFile) && Files.size(archivedFile) <= MAX_ARCHIVED_BYTES) {
                List<String> lines = Files.readAllLines(archivedFile);
                for (String line : lines) {
                    String name = line.split("\t", 2)[0].strip().toLowerCase(Locale.ROOT);
                    if (!name.isEmpty() && !name.startsWith("#") && name.matches("[\\w.-]{1,40}")) {
                        archived.add(name);
                    }
                }
            }
        } catch (IOException | RuntimeException exception) {
            logger.warn("Could not read " + archivedFile + ", leaving the server list as it is", exception);
            return;
        }

        for (RegisteredServer server : List.copyOf(proxy.getAllServers())) {
            ServerInfo info = server.getServerInfo();
            String name = info.getName().toLowerCase(Locale.ROOT);
            if (archived.contains(name) && !hiddenServers.containsKey(name)) {
                proxy.unregisterServer(info);
                hiddenServers.put(name, info);
                logger.info("Archived: took " + info.getName() + " off the server list");
            }
        }
        for (String name : List.copyOf(hiddenServers.keySet())) {
            if (!archived.contains(name)) {
                ServerInfo info = hiddenServers.remove(name);
                proxy.registerServer(info);
                logger.info("No longer archived: put " + info.getName() + " back on the server list");
            }
        }
    }

    private Component kickMessage(Whitelist current, Player player) {
        return message(current.message(), player);
    }

    /* A message from the file, with {name} filled in. The name is escaped, so a name can never add
       tags of its own; markup that doesn't parse falls back to the default message. */
    private Component message(String template, Player player) {
        String text = template.replace("{name}", MINI_MESSAGE.escapeTags(player.getUsername()));
        try {
            return MINI_MESSAGE.deserialize(text);
        } catch (RuntimeException badMarkup) {
            return MINI_MESSAGE.deserialize(Whitelist.DEFAULT_MESSAGE);
        }
    }

    private void flushSeen() {
        try {
            seenLog.flushIfDirty();
        } catch (IOException exception) {
            logger.warn("Could not write seen.tsv", exception);
        }
    }
}
