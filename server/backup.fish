# mc-backup: backs up the Minecraft worlds (and the rest of /data/minecraft) as dated archives.
# every folder in /data/minecraft is something you can back up, by its folder name, so a new
# world shows up here by itself as soon as its server has made its folder.
#
#   mc-backup                       everything
#   mc-backup survival anarchy      only these
#   mc-backup --list                what can be backed up, and the backups there are
#   mc-backup --keep 14 survival    keep the 14 newest backups of each (default 7)
#   mc-backup --to /mnt/nas/mc      put them somewhere else (default ~/backups/minecraft)
#   mc-backup --restore survival    put the newest backup back (or give a file after the name)
#   mc-backup --archive survival-old    pack a world you no longer play away for good, stop its server
#                                       and (if you say so) free its space
#   mc-backup --unarchive survival-old  bring an archived world back (or give a file after the name)
#
# archives live in <backups>/archive and are never thinned out by --keep.
# archiving is all there is to do: the world goes into /data/minecraft/archived/archived.txt (the
# proxy takes it off its server list, the API and website list it as archived) and its server is
# switched off in the stack's .env (MC_<NAME>=0), so mc-up leaves it off. unarchiving undoes both.
#
# a running server is told to stop writing to its world while it is copied (save-off), and to
# carry on afterwards, so the copy is never half-saved. players can keep playing.

set -l source_dir (set -q MC_DATA; and echo $MC_DATA; or echo /data/minecraft)
set -l default_dest $HOME/backups/minecraft
# the list of archived worlds (read-only for the proxy and the API) and the stack's own settings
set -l archived_list $source_dir/archived/archived.txt
set -l stack_env (set -q MC_STACK; and echo $MC_STACK; or echo $HOME/Docker/stacks/minecraft)/.env

# things the servers download again by themselves; leaving them out keeps the backups small
set -l excludes logs crash-reports debug .cache cache libraries versions

argparse h/help l/list 'k/keep=' 't/to=' r/restore a/archive u/unarchive -- $argv
or exit 1

set -l dest (set -q _flag_to; and echo $_flag_to; or echo $default_dest)
set -l keep (set -q _flag_keep; and echo $_flag_keep; or echo 7)
set -l archive_dir $dest/archive

# ---------- helpers ----------

function say
    set_color brcyan; echo -n "mc-backup "; set_color normal; echo $argv
end

function fail
    set_color red; echo -n "mc-backup "; set_color normal; echo $argv >&2
end

# every folder in the data folder, except the old copies a restore moved aside
function targets --argument-names source_dir
    for dir in $source_dir/*/
        set -l name (basename $dir)
        string match -q -- '*.before-restore-*' $name; or echo $name
    end
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

# whether a folder holds a world (a level.dat one level down)
function is_world --argument-names dir
    set -l found (find $dir -maxdepth 2 -name level.dat -print -quit 2>/dev/null)
    test -n "$found"
end

# the running container that has this folder mounted, if any
function container_for --argument-names dir
    for name in (docker ps --format '{{.Names}}')
        if docker inspect -f '{{range .Mounts}}{{println .Source}}{{end}}' $name | string match -q -- $dir
            echo $name
            return 0
        end
    end
    return 1
end

function rcon --argument-names container
    docker exec $container rcon-cli $argv[2..-1] >/dev/null 2>&1
end

# zstd when it's there (smaller and faster), gzip otherwise
function archive_ext
    command -q zstd; and echo tar.zst; or echo tar.gz
end

# ---------- help ----------

if set -q _flag_help
    echo "mc-backup [names...]         back up these folders of $source_dir (all of them without names)"
    echo "  -l, --list                 show what can be backed up and the backups there are"
    echo "  -k, --keep N               keep the N newest backups of each (now $keep)"
    echo "  -t, --to DIR               where the backups go (now $dest)"
    echo "  -r, --restore NAME [FILE]  put a backup back: the newest, or FILE"
    echo "  -a, --archive NAME         pack a world away for good and stop its server"
    echo "  -u, --unarchive NAME [FILE] bring an archived world back: the newest, or FILE"
    exit 0
end

if not test -d $source_dir
    fail "there is no $source_dir here"
    exit 1
end

set -l all (targets $source_dir)

# ---------- list ----------

if set -q _flag_list
    for name in $all
        set -l kind (is_world $source_dir/$name; and echo world; or echo files)
        set -l size (du -sh $source_dir/$name 2>/dev/null | cut -f1)
        set -l backups $dest/$name/$name-*.tar.*
        set -l newest "no backups yet"
        if test (count $backups) -eq 1
            set newest "1 backup:" (path basename $backups[-1])
        else if test (count $backups) -gt 1
            set newest (count $backups) "backups, newest:" (path basename $backups[-1])
        end
        printf "  %-16s %-6s %6s   %s\n" $name $kind $size "$newest"
    end
    set -l archived $archive_dir/*.tar.*
    if test (count $archived) -gt 0
        echo
        echo "  archived:"
        for file in $archived
            printf "  %-40s %6s\n" (path basename $file) (du -h $file | cut -f1)
        end
    end
    exit 0
end

# ---------- archive ----------

if set -q _flag_archive
    set -l name $argv[1]
    if not contains -- "$name" $all; or contains -- "$name" archived whitelist velocity
        fail "which one? one of: "(string join " " (string match -v -r '^(archived|whitelist|velocity)$' -- $all))
        exit 1
    end
    set -l dir $source_dir/$name
    set -l out $archive_dir/$name-(date +%Y-%m-%d_%H%M).(archive_ext)

    say "this packs all of $name into $out and stops its server; nobody can play it until it is brought back."
    read -l -P "type yes to go on: " answer
    if test "$answer" != yes
        say "nothing changed"
        exit 0
    end

    set -l container (container_for $dir)
    if test -n "$container"
        say "stopping $container"
        docker stop $container >/dev/null; or begin; fail "couldn't stop $container"; exit 1; end
    end

    mkdir -p $archive_dir
    say "packing $name (this can take a while for a big world)"
    if string match -q '*.zst' -- $out
        tar --zstd -cf $out -C $dir .
    else
        tar -z -cf $out -C $dir .
    end
    # only an archive that reads back whole counts
    if test $status -ne 0; or not tar -tf $out >/dev/null 2>&1
        rm -f $out
        fail "packing failed, nothing was removed"
        exit 1
    end
    say "packed: "(du -h $out | cut -f1)" in "(path basename $out)

    read -l -P "delete the live folder $dir to free its space? type $name to delete, anything else keeps it: " answer
    if test "$answer" = "$name"
        rm -rf $dir; and say "deleted $dir"
    else
        say "kept $dir; it still gets backed up with the rest until you delete it"
    end

    # the proxy, the API and the website read this list; .env keeps its server off on every mc-up
    mkdir -p (path dirname $archived_list)
    if not set_line $archived_list $name \t (date -u +%Y-%m-%dT%H:%M:%SZ)\t(stat -c %s $out)
        fail "couldn't write $archived_list; run: sudo chown $USER: "(path dirname $archived_list)", then --archive $name again"
        exit 1
    end
    set_line $stack_env (env_name $name) = 0
    say "archived: the proxy takes $name off its server list within a few seconds, the website lists it as archived,"
    say "and mc-up leaves its server off (from $stack_env). nothing else to do."
    exit 0
end

# ---------- unarchive ----------

if set -q _flag_unarchive
    set -l name $argv[1]
    if test -z "$name"
        fail "which one? the archived worlds are in $archive_dir"
        exit 1
    end
    set -l file $argv[2]
    if test -z "$file"
        set -l archived $archive_dir/$name-*.tar.*
        if test (count $archived) -eq 0
            fail "there is no archive of $name in $archive_dir"
            exit 1
        end
        set file $archived[-1]
    end
    if not test -f $file
        fail "can't find $file"
        exit 1
    end
    set -l dir $source_dir/$name
    if test -d $dir; and test (count $dir/*) -gt 0
        fail "$dir already has files in it; move them away first, nothing was changed"
        exit 1
    end

    mkdir -p $dir; and tar -xf $file -C $dir
    or begin; fail "unpacking failed"; exit 1; end
    say "$name is back in $dir, from "(path basename $file)"; the archive stays where it is"

    # off the archived list, and its server allowed to run again
    test -f $archived_list; and set_line $archived_list $name \t ""
    set_line $stack_env (env_name $name) = ""
    say "run mc-up to start its server; the proxy puts it back on its server list by itself."
    exit 0
end

# ---------- restore ----------

if set -q _flag_restore
    set -l name $argv[1]
    if not contains -- "$name" $all
        fail "which one? one of: $all"
        exit 1
    end
    set -l file $argv[2]
    if test -z "$file"
        set -l backups $dest/$name/$name-*.tar.*
        if test (count $backups) -eq 0
            fail "there are no backups of $name in $dest/$name"
            exit 1
        end
        set file $backups[-1]
    end
    if not test -f $file
        fail "can't find $file"
        exit 1
    end

    set -l dir $source_dir/$name
    set -l aside $dir.before-restore-(date +%Y-%m-%d_%H%M)
    say "this puts $file back into $dir."
    say "what is there now is kept, moved to $aside (nothing is deleted)."
    read -l -P "type yes to go on: " answer
    if test "$answer" != yes
        say "nothing changed"
        exit 0
    end

    set -l container (container_for $dir)
    if test -n "$container"
        say "stopping $container"
        docker stop $container >/dev/null; or begin; fail "couldn't stop $container"; exit 1; end
    end
    mv $dir $aside; and mkdir -p $dir; and tar -xf $file -C $dir
    set -l ok $status
    if test -n "$container"
        say "starting $container"
        docker start $container >/dev/null
    end
    if test $ok -ne 0
        fail "the restore failed; the old files are in $aside"
        exit 1
    end
    say "done: $name is back to "(path basename $file)", the old files are in $aside"
    exit 0
end

# ---------- back up ----------

# if this is stopped halfway (ctrl-c), the paused world still gets to save again
set -g mc_backup_paused
function mc_backup_interrupted --on-signal INT --on-signal TERM
    if test -n "$mc_backup_paused"
        docker exec $mc_backup_paused rcon-cli save-on >/dev/null 2>&1
    end
    exit 130
end

set -l chosen $argv
if test (count $chosen) -eq 0
    set chosen $all
end
for name in $chosen
    if not contains -- $name $all
        fail "there is no '$name' in $source_dir, there are: $all"
        exit 1
    end
end
if not string match -qr '^[0-9]+$' -- $keep; or test $keep -lt 1
    fail "--keep needs a number of 1 or more"
    exit 1
end

set -l stamp (date +%Y-%m-%d_%H%M)
set -l ext (archive_ext)
set -l exclude_args
for pattern in $excludes
    set -a exclude_args --exclude=./$pattern --exclude=./*/$pattern
end
set -l failed

for name in $chosen
    set -l dir $source_dir/$name
    set -l out $dest/$name/$name-$stamp.$ext
    mkdir -p $dest/$name

    # a running world stops writing while it is copied
    set -l container
    if is_world $dir
        set container (container_for $dir)
    end
    if test -n "$container"
        set mc_backup_paused $container
        rcon $container save-off
        rcon $container save-all flush
        sleep 2
    end

    say "$name → $out"
    if test $ext = tar.zst
        tar --zstd $exclude_args -cf $out -C $dir .
    else
        tar -z $exclude_args -cf $out -C $dir .
    end
    set -l ok $status

    # the world goes back to saving, whatever happened
    if test -n "$container"
        rcon $container save-on
        set mc_backup_paused
    end

    if test $ok -ne 0
        fail "$name failed"
        rm -f $out
        set -a failed $name
        continue
    end

    # only the newest $keep stay
    set -l backups $dest/$name/$name-*.tar.*
    set -l extra (math (count $backups) - $keep)
    if test $extra -gt 0
        rm -f $backups[1..$extra]
    end
    say "  "(du -h $out | cut -f1)", keeping "(math "min("(count $backups)", $keep)")" of $name"
end

if test (count $failed) -gt 0
    fail "these failed: $failed"
    exit 1
end
say "done, everything is in $dest"
