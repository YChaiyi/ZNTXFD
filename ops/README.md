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
- Every code release contains a root-owned manifest with a complete directory
  inventory plus SHA-256 hashes for every regular file and symbolic-link
  target, including source, dependencies, and build output. After validation,
  all regular files and directories in the release receive the Linux immutable attribute.
  Same-SHA adoption also compares the complete source file set and every source
  file hash against a fresh GitHub `main` checkout. App startup, same-SHA
  deployment, content promotion, and rollback recursively reject a missing
  marker, changed hash, wrong owner, writable path, or missing immutable bit.
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

The runtime environment file may remain empty unless a deployment needs an
explicit app override. Content and Token Rank paths are fixed by the systemd
unit and are not stored in Git.

The bootstrap creates a valid empty Token Rank store only when no store is
present. It validates that store before the app can start.

For an already migrated host whose active release predates release sealing, do
not run `prepare` directly. Install the integrity tooling, then deploy a new
clean `main` SHA through the one-time recovery path. The recovery path moves
the unsealed tree into a hidden quarantine directory, never records it as a
normal rollback target, validates and externalizes any embedded legacy daily
and knowledge content, and restores the old pair as an emergency fallback if
the new release fails:

```bash
sudo bash ops/bootstrap_vps.sh prepare-integrity
sudo /usr/local/bin/znt-code-deploy --recover-unsealed <new-main-sha>
sudo bash ops/bootstrap_vps.sh prepare
sudo systemctl restart znt-group.service
```

`prepare-integrity` changes only the root-owned integrity/recovery validators
and code deployer. The recovery command builds and verifies the requested SHA
from the public `main`, seals it, snapshots any complete legacy `data/` and
`public/digest-images/` tree into a validated content release, switches the
new code/content pair atomically, and writes an empty previous pair. It aborts
if that legacy content changes during the build. Only a sealed active release
permits `prepare` to replace the application entrypoint. After the first
successful recovery, publish one further clean commit before relying on normal
paired rollback.

If the existing restricted deployer can first activate a new, clean `main` SHA,
the active release can instead be adopted in place without trusting its
directory name:

```bash
# First deploy <new-main-sha> through the existing restricted GitHub workflow.
sudo bash /var/www/znt.group/current/ops/bootstrap_vps.sh prepare-integrity
sudo /usr/local/bin/znt-code-deploy <same-new-main-sha>
sudo bash /var/www/znt.group/current/ops/bootstrap_vps.sh prepare
sudo systemctl restart znt-group.service
```

Same-SHA adoption requires the running health endpoint to report the exact SHA,
content version, and Token Rank partial-upload protocol. It then compares every
source path and hash against a fresh public `main` checkout before writing the
manifest and immutable attributes. Do not invoke rollback until one further
clean `main` SHA has been deployed, because the preceding state may still point
to the polluted legacy release.

Do not install either public deployment key before the first migration has
succeeded. The legacy tree is preserved as-is during candidate preparation;
keeping both restricted accounts keyless prevents a remote session from
reading legacy world-readable content outside the build sandbox.

After migration verification, install the Actions key only for `zntdeploy`
and the daily workstation key only for `zntcontent`. Both accounts have locked
passwords. The key files and SSH policy are root-owned; each key file is
group-readable only by its matching restricted account and is not writable by
that account. `ForceCommand` accepts only `deploy-code <sha>` or
`upload-content`/`promote-content`.
Remove every workstation-shared key from `/home/ubuntu/.ssh/authorized_keys`
after a separately held administrator key has been tested. A publisher with an
`ubuntu` shell or unrestricted sudo can bypass the content boundary and must
be treated as a migration failure.
Prefix each public-key line with `restrict` as an additional OpenSSH defense:

```bash
sudoedit /etc/ssh/authorized_keys/zntdeploy
sudoedit /etc/ssh/authorized_keys/zntcontent
sudo chown root:zntdeploy /etc/ssh/authorized_keys/zntdeploy
sudo chown root:zntcontent /etc/ssh/authorized_keys/zntcontent
sudo chmod 0640 /etc/ssh/authorized_keys/zntdeploy /etc/ssh/authorized_keys/zntcontent
sudo /usr/sbin/sshd -t
sudo systemctl reload ssh.service
```

Install the Token Rank registration/upload limits from
`ops/nginx/znt.group.conf` into the existing server configuration. Preserve
the existing `/stats/` GoatCounter location and TLS directives. The health
endpoint remains localhost-only.

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
pointers, then restart and verify `/api/health`. Health validation requires
the exact build SHA plus Token Rank upload protocol 2 with partial-upload
support; a correct-looking release directory name is not sufficient. The
state file stores the
current pair and its exact preceding pair, so rollback toggles whole
code/content combinations rather than a stale single pointer.

Migration snapshots are protected from retention. Normal retention keeps the
latest three code releases and thirty content releases while also preserving
the active and rollback pair.
