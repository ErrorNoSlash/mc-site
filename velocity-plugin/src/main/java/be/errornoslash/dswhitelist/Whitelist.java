package be.errornoslash.dswhitelist;

import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/*
 * One loaded copy of whitelist.txt. The file is tab separated, one entry per line:
 *
 *   # comment
 *   enabled   true
 *   message   <red>Not whitelisted.</red><newline>Request access at example.com
 *   java      <uuid>        <name>
 *   bedrock   <uuid or ->   <.floodgate name>
 *
 * Unknown keys are ignored so newer API versions can add lines without breaking this.
 */
final class Whitelist {

    static final String DEFAULT_MESSAGE =
            "<red>You are not whitelisted on this server.</red>";

    static final Whitelist MISSING = new Whitelist(false, DEFAULT_MESSAGE, Set.of(), Set.of(), 0);

    private final boolean enforced;
    private final String message;
    private final Set<UUID> uuids;
    private final Set<String> bedrockNames;
    private final int size;

    private Whitelist(boolean enforced, String message, Set<UUID> uuids, Set<String> bedrockNames, int size) {
        this.enforced = enforced;
        this.message = message;
        this.uuids = uuids;
        this.bedrockNames = bedrockNames;
        this.size = size;
    }

    static Whitelist parse(List<String> lines) {
        boolean enforced = false;
        String message = DEFAULT_MESSAGE;
        Set<UUID> uuids = new HashSet<>();
        Set<String> bedrockNames = new HashSet<>();
        int size = 0;

        for (String raw : lines) {
            String line = raw.strip();
            if (line.isEmpty() || line.startsWith("#")) {
                continue;
            }
            String[] parts = raw.split("\t", -1);
            switch (parts[0].strip()) {
                case "enabled" -> enforced = parts.length > 1 && parts[1].strip().equalsIgnoreCase("true");
                case "message" -> {
                    if (parts.length > 1 && !parts[1].isBlank()) {
                        message = parts[1];
                    }
                }
                case "java" -> {
                    if (parts.length > 1) {
                        uuids.add(UUID.fromString(parts[1].strip()));
                        size++;
                    }
                }
                case "bedrock" -> {
                    if (parts.length > 2) {
                        String uuid = parts[1].strip();
                        if (!uuid.isEmpty() && !uuid.equals("-")) {
                            uuids.add(UUID.fromString(uuid));
                        }
                        bedrockNames.add(parts[2].strip().toLowerCase(Locale.ROOT));
                        size++;
                    }
                }
                default -> {
                    // a newer line type: ignore
                }
            }
        }
        return new Whitelist(enforced, message, Set.copyOf(uuids), Set.copyOf(bedrockNames), size);
    }

    boolean enforced() {
        return enforced;
    }

    String message() {
        return message;
    }

    int size() {
        return size;
    }

    boolean allows(UUID uuid, String username) {
        if (uuids.contains(uuid)) {
            return true;
        }
        // only Floodgate players (UUID with the top half zero) may match by name
        return uuid.getMostSignificantBits() == 0
                && bedrockNames.contains(username.toLowerCase(Locale.ROOT));
    }
}
