# VPS 部署与首次迁移

生产目录把代码、内容和运行态彻底分开：

```text
/var/www/znt.group/
  current -> releases/<40-char-sha>
  releases/
    <sha>/
    .protected/<migration-sha>
  builds/                           # only zntdeploy can write
    .isolation/                      # root-owned candidate boundary
  shared/
    content/
      current -> releases/<content-version>
      releases/
        <content-version>/
        .protected/<migration-version>
      staging/                      # only zntcontent can write
      .promotion/                    # root-owned candidate boundary
    runtime/app.env                 # root:zntapp 0640
    state/token-rank/
      token-rank-store.json         # zntapp:zntapp 0600
    deploy-state.json               # root-owned
    goatcounter/                    # preserved in place
  .migration-backups/<timestamp>/   # same-disk immutable migration snapshot
```

## Account boundary

- `zntapp` only runs Next.js. It can read releases, content, and
  `runtime/app.env`; it can write only
  `shared/state/token-rank/`.
- `zntdeploy` is the SSH account only for `YChaiyi/ZNTXFD` GitHub Actions.
  It is **not** in group `zntapp`, so it cannot read
  `app.env`, current content, Token Rank state, GoatCounter data, or active
  releases.
- `zntdeploy` can write only `builds/`. Its sudoers entry
  permits only code deployment. Manual paired rollback remains a root
  operator action.
- `zntcontent` is the daily workstation account. It can write only
  `shared/content/staging/`, and sudo can invoke only `znt-content-promote`.
- The root-owned publisher accepts only a 40-character SHA, then clones the
  literal public URL `https://github.com/YChaiyi/ZNTXFD.git` and requires both
  the checked-out `main` and a fresh remote `main` lookup to equal that SHA.
  It does not accept a source archive, archive hash, alternate URL, or
  alternate ref from Actions. Submodules, Git LFS, links, special files,
  excessive source trees, and non-source data are rejected. Git runs with a
  clean HOME/config, no credential prompt/helper, and no access to production
  content or runtime state. A second remote-main check immediately before
  activation rejects a commit that became stale during the build.
- Candidate code runs as `zntdeploy`. A completed build is copied into a
  root-owned release candidate before validation and activation, so the
  deployment account cannot retain a writable path or file descriptor into
  the app release. Dependency scripts and the Next.js build run in a
  transient systemd sandbox that cannot see `current` or `shared`; build-time
  network access is disabled after package download. Clone/build commands have
  memory, task, runtime, file-size, and reserved-disk limits. Content follows
  the same boundary. Validation uses the root-owned validator in
  `/usr/local/lib/znt/`, never a file from the active release.
- SSH public keys are stored in root-owned files under
  `/etc/ssh/authorized_keys/`. `sshd` applies a root-owned `ForceCommand` to
  each account, so a deployment key cannot open a shell, modify its own key
  file, or run commands outside the upload/promote protocol.

Do not add `zntdeploy` or `zntcontent` to `zntapp`.

## One-time preparation

The VPS uses Node.js 24 and npm from `/usr/local/bin/node` and
`/usr/local/bin/npm`. Bootstrap refuses a different Node major so CI, builds,
validators, and the running service cannot silently use different runtimes.
Run the preparation step as root; it does not change the active site or
systemd unit.

```bash
cd /path/to/ZNTXFD
sudo bash ops/bootstrap_vps.sh prepare
sudoedit /var/www/znt.group/shared/runtime/app.env
```

Set at least:

```dotenv
ACCESS_PASSWORD=...
ACCESS_SESSION_SECRET=at-least-32-random-characters
```

The bootstrap creates a valid empty Token Rank store only when no store is
present. It validates that store before the app can start.

Do not install either public deployment key before the first migration has
succeeded. The legacy tree is preserved as-is during candidate preparation;
keeping both restricted accounts keyless prevents a remote session from
reading legacy world-readable content outside the build sandbox.

After migration verification, install the Actions key only for `zntdeploy`
and the daily workstation key only for `zntcontent`. Both accounts have locked
passwords. The key files and SSH policy are root-owned; `ForceCommand` accepts
only `deploy-code <sha>` or `upload-content`/`promote-content`.
Prefix each public-key line with `restrict` as an additional OpenSSH defense:

```bash
sudoedit /etc/ssh/authorized_keys/zntdeploy
sudoedit /etc/ssh/authorized_keys/zntcontent
sudo chown root:root /etc/ssh/authorized_keys/zntdeploy /etc/ssh/authorized_keys/zntcontent
sudo chmod 0600 /etc/ssh/authorized_keys/zntdeploy /etc/ssh/authorized_keys/zntcontent
sudo /usr/sbin/sshd -t
sudo systemctl reload ssh.service
```

Install the Nginx limits from `ops/nginx/znt.group.conf` into the existing
server configuration. Preserve the existing `/stats/` GoatCounter location
and TLS directives. The health endpoint remains localhost-only.

## First migration

Pause code and daily publishing first. The migration stops the old
`znt-group.service`, takes a same-filesystem snapshot under
`/var/www/znt.group/.migration-backups/`, creates initial separate code and
content releases, then switches both links and starts the hardened service.

Pass the actual GoatCounter SQLite database path so the script can make a
consistent SQLite backup:

```bash
sudo bash ops/bootstrap_vps.sh migrate \
  --source-sha <git-sha> \
  --confirm-migration \
  --goatcounter-db /var/www/znt.group/shared/goatcounter/db.sqlite3
```

The script moves the old `current` directory into its root-only migration
snapshot as `legacy-current/`, keeps migration releases permanently, and
restores the previous unit and entrypoint if its health check fails. It never
deletes production data.

## GitHub Actions and daily content

Configure these GitHub production secrets:

- `ZNT_DEPLOY_HOST`
- `ZNT_DEPLOY_USER=zntdeploy`
- `ZNT_DEPLOY_SSH_KEY`
- `ZNT_DEPLOY_KNOWN_HOSTS`

Keep the repository variable `ZNT_DEPLOY_ENABLED` unset or set to `false`
until the restricted VPS account, both SSH keys, and a dry-run release have
passed validation. Set it to `true` only when automatic `main` deployment is
ready to go live.

The workflow sends only `deploy-code <github.sha>` through the forced command.
The VPS independently clones the current public `main`, verifies its real Git
commit against that request before and after the build, enforces the source-only
policy, and only then activates the release. The VPS therefore does not trust
an Actions-produced source package or a caller-provided package hash.

The daily publisher must SSH as `zntcontent`. Its forced command accepts a
bounded tar stream, extracts only regular files and directories into an
isolated staging directory, then permits promotion of that exact version. It
must not use the old `ubuntu` deployment account.

## Release behavior

All code deployment, content promotion, and rollback commands use the same
VPS lock. Code and rollback stop the app before switching both release
pointers, then restart and verify `/api/health`. The state file stores the
current pair and its exact preceding pair, so rollback toggles whole
code/content combinations rather than a stale single pointer.

Migration snapshots are protected from retention. Normal retention keeps the
latest three code releases and thirty content releases while also preserving
the active and rollback pair.
