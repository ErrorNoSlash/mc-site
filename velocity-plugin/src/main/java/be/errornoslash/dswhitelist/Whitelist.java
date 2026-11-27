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
 *   blockmessage  <what a blacklisted player sees>
 *   blocked   <java|bedrock>   <uuid or ->   <name>
 *
 * A blocked (blacklisted) player is turned away whether the whitelist is enforced or not.
 *
 * Unknown keys are ignored so newer API versions can add lines without breaking this.
 * The file comes from the website's API, so it is not trusted blindly: a line that doesn't
 * parse is skipped (not the whole file), and the message and the number of players are capped.
 */
final class Whitelist {

    static final String DEFAULT_MESSAGE =
            "<red>You are not whitelisted on this server.</red>";

    static final String DEFAULT_BLOCK_MESSAGE = "<red>You can't join this server.</red>";

    static final Whitelist MISSING = new Whitelist(false, DEFAULT_MESSAGE, Set.of(), Set.of(), 0,
            DEFAULT_BLOCK_MESSAGE, Set.of(), Set.of());

    // more than any real whitelist; anything past this is ignored
    static final int MAX_PLAYERS = 10_000;
    static final int MAX_MESSAGE_LENGTH = 2_000;

    private final boolean enforced;
    private final String message;
    private final Set<UUID> uuids;
    private final Set<String> bedrockNames;
    private final int size;
    private final String blockMessage;
    private final Set<UUID> blockedUuids;
    // names only count for players without a uuid in the list (a Bedrock player before they joined)
    private final Set<String> blockedNames;

    private Whitelist(boolean enforced, String message, Set<UUID> uuids, Set<String> bedrockNames, int size,
                      String blockMessage, Set<UUID> blockedUuids, Set<String> blockedNames) {
        this.enforced = enforced;
        this.message = message;
        this.uuids = uuids;
        this.bedrockNames = bedrockNames;
        this.size = size;
        this.blockMessage = blockMessage;
        this.blockedUuids = blockedUuids;
        this.blockedNames = blockedNames;
    }

    static Whitelist parse(List<String> lines) {
        boolean enforced = false;
        String message = DEFAULT_MESSAGE;
        Set<UUID> uuids = new HashSet<>();
        Set<String> bedrockNames = new HashSet<>();
        int size = 0;
        String blockMessage = DEFAULT_BLOCK_MESSAGE;
        Set<UUID> blockedUuids = new HashSet<>();
        Set<String> blockedNames = new HashSet<>();
        int blockedCount = 0;

        for (String raw : lines) {
            String line = raw.strip();
            if (line.isEmpty() || line.startsWith("#")) {
                continue;
            }
            String[] parts = raw.split("\t", -1);
            try {
                switch (parts[0].strip()) {
                    case "enabled" -> enforced = parts.length > 1 && parts[1].strip().equalsIgnoreCase("true");
                    case "message" -> {
                        if (parts.length > 1 && !parts[1].isBlank() && parts[1].length() <= MAX_MESSAGE_LENGTH) {
                            message = parts[1];
                        }
                    }
                    case "java" -> {
                        if (parts.length > 1 && size < MAX_PLAYERS) {
                            uuids.add(UUID.fromString(parts[1].strip()));
                            size++;
                        }
                    }
                    case "bedrock" -> {
                        if (parts.length > 2 && size < MAX_PLAYERS) {
                            String uuid = parts[1].strip();
                            if (!uuid.isEmpty() && !uuid.equals("-")) {
                                uuids.add(UUID.fromString(uuid));
                            }
                            bedrockNames.add(parts[2].strip().toLowerCase(Locale.ROOT));
                            size++;
                        }
                    }
                    case "blockmessage" -> {
                        if (parts.length > 1 && !parts[1].isBlank() && parts[1].length() <= MAX_MESSAGE_LENGTH) {
                            blockMessage = parts[1];
                        }
                    }
                    case "blocked" -> {
                        if (parts.length > 3 && blockedCount < MAX_PLAYERS) {
                            String uuid = parts[2].strip();
                            if (!uuid.isEmpty() && !uuid.equals("-")) {
                                blockedUuids.add(UUID.fromString(uuid));
                            } else {
                                blockedNames.add(parts[3].strip().toLowerCase(Locale.ROOT));
                            }
                            blockedCount++;
                        }
                    }
                    default -> {
                        // a newer line type: ignore
                    }
                }
            } catch (IllegalArgumentException badLine) {
                // not a uuid: skip this line, keep the rest
            }
        }
        return new Whitelist(enforced, message, Set.copyOf(uuids), Set.copyOf(bedrockNames), size,
                blockMessage, Set.copyOf(blockedUuids), Set.copyOf(blockedNames));
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

    String blockMessage() {
        return blockMessage;
    }

    int blockedSize() {
        return blockedUuids.size() + blockedNames.size();
    }

    boolean blocks(UUID uuid, String username) {
        return blockedUuids.contains(uuid) || blockedNames.contains(username.toLowerCase(Locale.ROOT));
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
