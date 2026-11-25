package be.errornoslash.dswhitelist;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/*
 * Remembers who tried to log in, so the admin page can whitelist people who already play here.
 * seen.tsv columns: uuid, name, edition (java/bedrock), first seen, last seen (epoch ms),
 * logins, and whether the last attempt was turned away.
 */
final class SeenLog {

    private static final int MAX_ENTRIES = 1000;

    private record Entry(UUID uuid, String name, String edition, long firstSeen, long lastSeen,
                         int logins, boolean turnedAway) {
        String toLine() {
            return uuid + "\t" + name + "\t" + edition + "\t" + firstSeen + "\t" + lastSeen
                    + "\t" + logins + "\t" + turnedAway;
        }
    }

    private final Path file;
    private final Map<UUID, Entry> entries = new ConcurrentHashMap<>();
    private volatile boolean dirty;

    SeenLog(Path file) {
        this.file = file;
    }

    void load() throws IOException {
        List<String> lines;
        try {
            lines = Files.readAllLines(file, StandardCharsets.UTF_8);
        } catch (NoSuchFileException missing) {
            return;
        }
        for (String line : lines) {
            String[] parts = line.split("\t", -1);
            if (parts.length < 7 || line.startsWith("#")) {
                continue;
            }
            try {
                UUID uuid = UUID.fromString(parts[0]);
                entries.put(uuid, new Entry(uuid, parts[1], parts[2], Long.parseLong(parts[3]),
                        Long.parseLong(parts[4]), Integer.parseInt(parts[5]), Boolean.parseBoolean(parts[6])));
            } catch (IllegalArgumentException skip) {
                // a damaged line: drop it
            }
        }
    }

    void record(UUID uuid, String name, boolean turnedAway) {
        long now = System.currentTimeMillis();
        String edition = uuid.getMostSignificantBits() == 0 ? "bedrock" : "java";
        entries.compute(uuid, (key, old) -> old == null
                ? new Entry(uuid, name, edition, now, now, 1, turnedAway)
                : new Entry(uuid, name, edition, old.firstSeen(), now, old.logins() + 1, turnedAway));
        dirty = true;
    }

    synchronized void flushIfDirty() throws IOException {
        if (!dirty) {
            return;
        }
        dirty = false;

        List<Entry> sorted = new ArrayList<>(entries.values());
        sorted.sort(Comparator.comparingLong(Entry::lastSeen).reversed());
        if (sorted.size() > MAX_ENTRIES) {
            for (Entry old : sorted.subList(MAX_ENTRIES, sorted.size())) {
                entries.remove(old.uuid());
            }
            sorted = sorted.subList(0, MAX_ENTRIES);
        }

        StringBuilder out = new StringBuilder("# uuid\tname\tedition\tfirst_seen\tlast_seen\tlogins\tturned_away\n");
        for (Entry entry : sorted) {
            out.append(entry.toLine()).append('\n');
        }

        Path temporary = file.resolveSibling(file.getFileName() + ".tmp");
        Files.writeString(temporary, out, StandardCharsets.UTF_8);
        try {
            Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException notAtomic) {
            Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
        }
    }
}
