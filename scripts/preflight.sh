#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Ops Monitor — preflight check for the host you intend to deploy on.
#
# READ-ONLY. It starts nothing, stops nothing, writes nothing, and never prints
# a secret's value — only whether one is set. Safe to run on a live box.
#
#   bash scripts/preflight.sh              # human-readable report
#   bash scripts/preflight.sh > report.txt # capture and paste it back
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

B=$'\033[1m'; D=$'\033[2m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'
[ -t 1 ] || { B=''; D=''; G=''; Y=''; R=''; N=''; }

h()  { printf '\n%s── %s %s\n' "$B" "$1" "$N"; }
ok() { printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
wn() { printf '  %s!%s %s\n' "$Y" "$N" "$1"; }
no() { printf '  %s✗%s %s\n' "$R" "$N" "$1"; }
kv() { printf '  %s%-26s%s %s\n' "$D" "$1" "$N" "$2"; }
have(){ command -v "$1" >/dev/null 2>&1; }

printf '%sOps Monitor — preflight%s   %s\n' "$B" "$N" "$(date -u '+%Y-%m-%d %H:%MZ')"

# ── host ─────────────────────────────────────────────────────────────────────
h "Host"
kv "hostname" "$(hostname 2>/dev/null || echo '?')"
if [ -r /etc/os-release ]; then . /etc/os-release; kv "os" "${PRETTY_NAME:-?}"; else kv "os" "$(uname -sr)"; fi
kv "arch" "$(uname -m)"
kv "kernel" "$(uname -r)"

CPUS=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo '?')
kv "cpus" "$CPUS"

if have free; then
  MEM_MB=$(free -m | awk '/^Mem:/{print $2}')
  kv "memory" "${MEM_MB} MB"
  if   [ "${MEM_MB:-0}" -lt 1024 ]; then no "under 1 GB — the build will very likely OOM"
  elif [ "${MEM_MB:-0}" -lt 1900 ]; then wn "under 2 GB — add swap before 'up --build'"
  else ok "memory is sufficient"; fi
  SWAP_MB=$(free -m | awk '/^Swap:/{print $2}')
  kv "swap" "${SWAP_MB} MB"
fi

if have df; then kv "disk free (/)" "$(df -h / | awk 'NR==2{print $4" of "$2}')"; fi

# ── networking / public IP ───────────────────────────────────────────────────
h "Networking"
LOCAL_IPS=$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $2": "$4}' | paste -sd', ' - 2>/dev/null)
kv "local addresses" "${LOCAL_IPS:-?}"

PUB=$(curl -fsS --max-time 6 https://api.ipify.org 2>/dev/null || echo '')
if [ -n "$PUB" ]; then
  kv "egress public IP" "$PUB"
  MATCH=no
  while read -r a; do [ "$a" = "$PUB" ] && MATCH=yes; done < <(ip -4 -o addr show scope global 2>/dev/null | awk '{split($4,x,"/"); print x[1]}')
  if [ "$MATCH" = yes ]; then
    ok "this host holds its public IP directly (a tunnel is optional)"
  else
    wn "behind NAT/CGNAT — no inbound reachability. Cloudflare Tunnel is REQUIRED"
  fi
else
  wn "could not determine egress IP (no outbound HTTPS?)"
fi

# Cloudflare Tunnel needs outbound 7844 (QUIC preferred, TCP fallback).
if have nc; then
  if nc -z -w4 region1.v2.argotunnel.com 7844 2>/dev/null; then
    ok "outbound TCP 7844 to Cloudflare reachable"
  else
    no "outbound TCP 7844 BLOCKED — cloudflared cannot connect"
  fi
else
  wn "nc not installed; skipped the 7844 egress test  (apt-get install -y netcat-openbsd)"
fi

# ── docker ───────────────────────────────────────────────────────────────────
h "Docker"
if have docker; then
  kv "docker" "$(docker --version 2>/dev/null)"
  kv "compose" "$(docker compose version --short 2>/dev/null || echo 'plugin MISSING')"
  if docker info >/dev/null 2>&1; then
    ok "daemon reachable as $(id -un)"
  else
    no "daemon not reachable — start it, or add yourself to the docker group"
  fi
else
  no "docker not installed"
fi

# ── EXISTING cloudflared (the thing we most need to know about) ──────────────
h "Existing cloudflared"
if have docker && docker info >/dev/null 2>&1; then
  CF=$(docker ps --format '{{.ID}} {{.Image}} {{.Names}}' 2>/dev/null | grep -i cloudflared | awk '{print $1}')

  if [ -z "$CF" ]; then
    wn "no running cloudflared container found"
  else
    for id in $CF; do
      NAME=$(docker inspect -f '{{.Name}}' "$id" 2>/dev/null | sed 's|^/||')
      IMG=$(docker inspect -f '{{.Config.Image}}' "$id" 2>/dev/null)
      PROJ=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$id" 2>/dev/null)
      WDIR=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$id" 2>/dev/null)
      NETS=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$id" 2>/dev/null)
      # Redact the token: we only want to know THAT it is set.
      MODE=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$id" 2>/dev/null \
             | grep -q '^TUNNEL_TOKEN=' && echo 'token (env TUNNEL_TOKEN)' || echo '')
      CMD=$(docker inspect -f '{{join .Config.Cmd " "}}' "$id" 2>/dev/null | sed -E 's/(--token[= ])[A-Za-z0-9._-]+/\1<REDACTED>/g')
      case "$CMD" in *--config*) MODE="${MODE:+$MODE + }config file";; esac
      [ -n "$MODE" ] || MODE='(unclear — see cmd)'

      printf '  %s%s%s\n' "$B" "$NAME" "$N"
      kv "  image"          "$IMG"
      kv "  compose project" "${PROJ:-<not compose-managed>}"
      kv "  project dir"    "${WDIR:-?}"
      kv "  networks"       "${NETS:-?}"
      kv "  credential mode" "$MODE"
      kv "  cmd"            "${CMD:-?}"
    done
    printf '\n'
    wn "NEEDED: the \"networks\" value above goes into this project's compose as an external network."
  fi

  h "Docker networks"
  docker network ls --format '  {{.Name}}  ({{.Driver}})' 2>/dev/null

  h "Ports published by containers"
  BOUND=$(docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null | grep -v '^\S*\t$')
  if [ -z "$BOUND" ]; then ok "nothing published"; else printf '%s\n' "$BOUND" | sed 's/^/  /'; fi
fi

# ── port 80 availability ─────────────────────────────────────────────────────
h "Port 80"
if have ss; then
  L=$(ss -tlnp 2>/dev/null | awk 'NR>1 && $4 ~ /:80$/')
  if [ -z "$L" ]; then ok "port 80 is free"; else wn "port 80 already in use:"; printf '%s\n' "$L" | sed 's/^/    /'; fi
else
  wn "ss not available; could not check port 80"
fi

# ── firewall ─────────────────────────────────────────────────────────────────
h "Firewall"
if have ufw; then sudo -n ufw status 2>/dev/null | sed 's/^/  /' || wn "ufw present (needs sudo to read status)"; else kv "ufw" "not installed"; fi

# ── this checkout ────────────────────────────────────────────────────────────
h "Repository"
if [ -f docker-compose.yml ]; then
  ok "run from the project root"
  kv "compose project name" "$(awk -F': *' '/^name:/{print $2; exit}' docker-compose.yml)"
  if [ -f .env ]; then
    ok ".env present"
    for k in FRONTEND_URL POSTGRES_PASSWORD GOOGLE_CLIENT_ID; do
      v=$(grep -E "^${k}=" .env 2>/dev/null | head -1 | cut -d= -f2-)
      case "$k" in
        FRONTEND_URL) kv "$k" "${v:-<unset>}" ;;                      # not a secret
        *)            kv "$k" "$([ -n "$v" ] && echo 'set' || echo '<empty>')" ;;
      esac
    done
  else
    no ".env missing — cp .env.example .env"
  fi
  if have docker && docker info >/dev/null 2>&1; then
    h "Volumes for this project"
    docker volume ls --format '  {{.Name}}' 2>/dev/null | grep -E 'ops-monitor|opsmonitor' || echo '  (none yet)'
  fi
else
  wn "not in the project root — cd into the repo and re-run"
fi

printf '\n%sdone%s — paste this whole report back.\n' "$B" "$N"
