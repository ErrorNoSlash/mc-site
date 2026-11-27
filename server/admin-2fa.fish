# admin-2fa: sets up (or replaces) the second step of the admin login, a 6-digit code from an
# authenticator app (Aegis, 2FAS, Google Authenticator, Bitwarden, ...). run it once on the server:
#
#   fish ~/Docker/stacks/minecraft/mc-site/server/admin-2fa.fish
#
# it makes a new secret, puts it in secrets.yaml as ADMIN_TOTP_SECRET (sops) and shows it as a QR code
# in this terminal to scan. the secret is never written anywhere else. then run mc-up. running it again
# makes a new secret: the old app entry stops working, scan the new one.

set -l secrets (set -q MC_SECRETS; and echo $MC_SECRETS; or echo $HOME/nixos-config/secrets.yaml)

function say
    set_color brcyan; echo -n "admin-2fa "; set_color normal; echo $argv
end

if not test -f $secrets
    say "can't find $secrets (set MC_SECRETS to its path)"
    exit 1
end

# 20 random bytes in base32 (what the apps read), without the = padding
set -l secret (head -c 20 /dev/urandom | base32 | string replace -a '=' '')
if test (string length -- "$secret") -lt 32
    say "couldn't make a secret"
    exit 1
end

if not sops set $secrets '["ADMIN_TOTP_SECRET"]' "\"$secret\""
    say "couldn't write it to $secrets"
    set -e secret
    exit 1
end

set -l uri "otpauth://totp/DS%20Network:admin?secret=$secret&issuer=DS%20Network&digits=6&period=30"
echo
say "scan this in your authenticator app (it is the only time it is shown; don't screenshot or paste it anywhere):"
echo
if command -q qrencode
    qrencode -t ansiutf8 -- $uri
else
    nix run nixpkgs#qrencode -- -t ansiutf8 -- $uri
end
echo
say "can't scan? type this key in the app instead (time-based, 6 digits, 30 s):"
echo "  "(string replace -ra '(.{4})' '$1 ' -- $secret)
echo
say "then: mc-up (the API starts asking for the code), and commit secrets.yaml in ~/nixos-config"
set -e secret uri
