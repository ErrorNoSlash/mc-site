# mc-off / mc-on: turn a Minecraft server off on purpose, and allow it again. the website then shows
# it as "turned off" (with your reason, if you give one) instead of "down", and mc-up leaves it off.
#
#   mc-off anarchy                      stop it until you turn it back on
#   mc-off anarchy back in december     the same, with a line the website shows
#   mc-on anarchy                       allow it again, then run mc-up to start it
#   mc-off                              which servers are turned off
#
# it writes /data/minecraft/archived/off.txt (the API reads it, read-only) and MC_<NAME>=0 in the
# stack's .env, the same switch mc-backup --archive uses. the world itself isn't touched.

set -l source_dir (set -q MC_DATA; and echo $MC_DATA; or echo /data/minecraft)
set -l off_list $source_dir/archived/off.txt
set -l archived_list $source_dir/archived/archived.txt
set -l stack_env (set -q MC_STACK; and echo $MC_STACK; or echo $HOME/Docker/stacks/minecraft)/.env

function say
    set_color brcyan; echo -n "mc-power "; set_color normal; echo $argv
end

function fail
    set_color red; echo -n "mc-power "; set_color normal; echo $argv >&2
end

# MC_SURVIVAL_OLD for survival-old: the setting in .env that says how many of its server run
function env_name --argument-names name
    echo MC_(string upper -- $name | string replace -ra '[^A-Z0-9]' _)
end

# sets (or with no value, removes) one line in a "key<separator>value" file, keeping the rest
function set_line --argument-names file key separator value
    set -l kept
    if test -f $file
        for line in (cat $file)
            string match -q -- "$key$separator*" $line; or set -a kept $line
        end
    end
    test -n "$value"; and set -a kept "$key$separator$value"
    if test (count $kept) -gt 0
        printf '%s\n' $kept >$file.tmp
    else
        true >$file.tmp
    end
    and mv $file.tmp $file
end

# the running container that has this world mounted, if any
function container_for --argument-names dir
    for name in (docker ps --format '{{.Names}}')
        if docker inspect -f '{{range .Mounts}}{{println .Source}}{{end}}' $name | string match -q -- $dir
            echo $name
            return 0
        end
    end
    return 1
end

# the worlds: folders in the data folder, without the ones that aren't servers of their own
function worlds --argument-names source_dir
    for dir in $source_dir/*/
        set -l name (basename $dir)
        string match -q -r '^(archived|whitelist|velocity)$|\.before-restore-' -- $name; or echo $name
    end
end

set -l action $argv[1]
set -l name $argv[2]
# the reason is plain text on the website: one line, no tabs, 80 characters at most
set -l reason (string join " " -- $argv[3..] | string replace -ra '[\t\r\n]' ' ' | string sub -l 80)

# ---------- no name: what is off ----------
if test -z "$name"
    if not test -s $off_list
        say "nothing is turned off"
        exit 0
    end
    say "turned off:"
    for line in (cat $off_list)
        set -l parts (string split \t -- $line)
        printf '  %-16s since %s  %s\n' $parts[1] (string sub -l 10 -- $parts[2]) "$parts[3]"
    end
    exit 0
end

if not contains -- "$name" (worlds $source_dir)
    fail "which one? one of: "(string join " " (worlds $source_dir))
    exit 1
end
if test -f $archived_list; and string match -q -- "$name"\t'*' (cat $archived_list)
    fail "$name is archived; bring it back with mc-backup --unarchive $name first"
    exit 1
end

switch $action
    case off
        mkdir -p (path dirname $off_list)
        # "$reason" in quotes: with no reason it is an empty field, not a missing one
        if not set_line $off_list $name \t (date -u +%Y-%m-%dT%H:%M:%SZ)\t"$reason"
            fail "couldn't write $off_list; run: sudo chown $USER: "(path dirname $off_list)
            exit 1
        end
        set_line $stack_env (env_name $name) = 0
        set -l container (container_for $source_dir/$name)
        if test -n "$container"
            say "stopping $container"
            docker stop $container >/dev/null
        end
        set -l why ""
        test -n "$reason"; and set why " ($reason)"
        say "$name is turned off$why. the website shows it as turned off, not down,"
        say "and mc-up leaves it off until: mc-on $name"
    case on
        test -f $off_list; and set_line $off_list $name \t ""
        set_line $stack_env (env_name $name) = ""
        say "$name is allowed again: run mc-up to start it"
    case '*'
        fail "use: mc-off NAME [reason], mc-on NAME, or mc-off to list"
        exit 1
end
