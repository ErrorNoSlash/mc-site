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
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.minimessage.MiniMessage;
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
 */
@Plugin(
        id = "ds-whitelist",
        name = "DS Whitelist",
        version = "1.0.0",
        description = "Whitelist managed by the server website",
        authors = {"Dias Stas"})
public final class DsWhitelistPlugin {

    private static final MiniMessage MINI_MESSAGE = MiniMessage.miniMessage();

    private final ProxyServer proxy;
    private final Logger logger;
    private final Path dataDirectory;
    private final Path whitelistFile;
    private final SeenLog seenLog;

    private volatile Whitelist whitelist = Whitelist.MISSING;
    private long loadedModified = Long.MIN_VALUE;
    private boolean warnedMissing;

    @Inject
    public DsWhitelistPlugin(ProxyServer proxy, Logger logger, @DataDirectory Path dataDirectory) {
        this.proxy = proxy;
        this.logger = logger;
        this.dataDirectory = dataDirectory;
        this.whitelistFile = dataDirectory.resolve("whitelist.txt");
        this.seenLog = new SeenLog(dataDirectory.resolve("seen.tsv"));
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
        boolean listed = current.allows(player.getUniqueId(), player.getUsername());
        boolean turnedAway = current.enforced() && !listed;

        seenLog.record(player.getUniqueId(), player.getUsername(), turnedAway);

        if (turnedAway) {
            event.setResult(ResultedEvent.ComponentResult.denied(kickMessage(current, player)));
            logger.info("Turned away " + player.getUsername() + " (" + player.getUniqueId() + "): not whitelisted");
        }
    }

    private void tick() {
        if (reloadIfChanged()) {
            kickRemovedPlayers();
        }
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
            Whitelist loaded = Whitelist.parse(Files.readAllLines(whitelistFile));
            whitelist = loaded;
            loadedModified = modified;
            warnedMissing = false;
            logger.info("Whitelist loaded: " + loaded.size() + " players, "
                    + (loaded.enforced() ? "enforced" : "NOT enforced (everyone can join)"));
            return true;
        } catch (IOException | RuntimeException exception) {
            // keep the last good list rather than letting everyone in or locking everyone out
            logger.error("Could not read " + whitelistFile + ", keeping the previous whitelist", exception);
            loadedModified = modified;
            return false;
        }
    }

    private void kickRemovedPlayers() {
        Whitelist current = whitelist;
        if (!current.enforced()) {
            return;
        }
        for (Player player : proxy.getAllPlayers()) {
            if (!current.allows(player.getUniqueId(), player.getUsername())) {
                player.disconnect(kickMessage(current, player));
                logger.info("Kicked " + player.getUsername() + ": removed from the whitelist");
            }
        }
    }

    private Component kickMessage(Whitelist current, Player player) {
        String text = current.message().replace("{name}", player.getUsername());
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
