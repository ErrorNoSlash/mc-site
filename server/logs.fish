# mc-logs: the Minecraft stack's logs, on the server itself.
#
#   mc-logs                     what each part said last (the proxy, the API and every server), then stops
#   mc-logs survival            follow one live: survival, anarchy, limbo... or proxy, api (Ctrl-C to stop)
#   mc-logs proxy -n 500        start further back (default 100 lines)
#   mc-logs survival -g error   only lines with this word in them (any case)
#   mc-logs -f                  follow everything at once, each line marked with where it came from
#   mc-logs --list              what there is to look at
#
# names are the world folders (survival, anarchy...) plus proxy (Velocity) and api (Whitelist-API).

argparse h/help l/list f/follow 'n/lines=' 'g/grep=' -- $argv
or exit 1

if set -q _flag_help
    sed -n '3,10p' (status filename) | sed -E 's/^# ?//'
    exit 0
end

set -l lines (set -q _flag_lines; and echo $_flag_lines; or echo 100)
if not string match -q -r '^[0-9]+$' -- $lines
    echo "mc-logs: -n wants a number" >&2
    exit 1
end

# the stack's containers, by the short name you type: the proxy and the API first, then the worlds
function containers
    set -l names (docker ps -a --format '{{.Names}}' | sort)
    contains Velocity $names; and echo proxy\tVelocity
    contains Whitelist-API $names; and echo api\tWhitelist-API
    for name in $names
        string match -q 'MC-*' -- $name; and echo (string lower (string replace 'MC-' '' $name))\t$name
    end
end

# a line of colour for each part, so a mixed log stays readable
function colour_for --argument-names short
    switch $short
        case proxy
            echo brcyan
        case api
            echo brmagenta
        case '*'
            echo bryellow
    end
end

set -l known (containers)

if set -q _flag_list
    for entry in $known
        set -l parts (string split \t -- $entry)
        set -l state (docker inspect -f '{{.State.Status}}' $parts[2] 2>/dev/null)
        printf '  %-14s %-16s %s\n' $parts[1] $parts[2] $state
    end
    exit 0
end

# only lines with the word in them, when -g was given (grep, line by line, so following stays live)
function only_matching --argument-names word
    if test -n "$word"
        grep -i -F --line-buffered -- $word
    else
        cat
    end
end

set -l word (set -q _flag_grep; and echo $_flag_grep)

# ---------- one part: follow it live ----------
if test (count $argv) -gt 0
    set -l container
    for entry in $known
        set -l parts (string split \t -- $entry)
        if test "$parts[1]" = (string lower -- $argv[1]); or test "$parts[2]" = $argv[1]
            set container $parts[2]
        end
    end
    if test -z "$container"
        echo "mc-logs: which one? one of: "(string join " " (string split -f1 \t -- $known)) >&2
        exit 1
    end
    docker logs --follow --tail $lines --timestamps $container 2>&1 | only_matching "$word"
    exit 0
end

# ---------- everything ----------
if set -q _flag_follow
    # one follower per part, all in the background; Ctrl-C stops them all
    for entry in $known
        set -l parts (string split \t -- $entry)
        test (docker inspect -f '{{.State.Running}}' $parts[2] 2>/dev/null) = true; or continue
        set -l tag (set_color (colour_for $parts[1]))(string pad -r -w 8 -- $parts[1])(set_color normal)
        docker logs --follow --tail 10 $parts[2] 2>&1 | only_matching "$word" | sed -u "s/^/$tag /" &
    end
    function stop_followers --on-signal INT --on-signal TERM
        kill (jobs -p) 2>/dev/null
    end
    wait
    exit 0
end

# no name: the last lines of each, one after another
set -l each (math "min($lines, 15)")
set -q _flag_lines; and set each $lines
for entry in $known
    set -l parts (string split \t -- $entry)
    set -l state (docker inspect -f '{{.State.Status}}' $parts[2] 2>/dev/null)
    echo
    set_color --bold (colour_for $parts[1])
    echo "── $parts[1] ($parts[2], $state)"
    set_color normal
    docker logs --tail $each $parts[2] 2>&1 | only_matching "$word"
end
