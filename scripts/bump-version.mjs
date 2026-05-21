#!/usr/bin/env node
/**
 * Linked-version bump for all publishable packages.
 *
 * Usage:
 *   node scripts/bump-version.mjs <patch|minor|major>
 *   node scripts/bump-version.mjs <explicit-version>     # e.g. 0.3.0-beta.1
 *
 * Reads the current version from `packages/core/package.json` (treated
 * as the source of truth), computes the next version, writes it to
 * every package under `packages/`. The root and `examples/` are left
 * alone.
 *
 * Prints the resolved next version to stdout so the calling workflow
 * can capture it for tag / release-notes use.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const arg = process.argv[2]
if (!arg) {
  console.error('Usage: bump-version.mjs <patch|minor|major|explicit-version>')
  process.exit(1)
}

const PACKAGES_DIR = 'packages'
const SOURCE_OF_TRUTH = join(PACKAGES_DIR, 'core', 'package.json')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, data) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)

const parseSemver = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v)
  if (!m) throw new Error(`not a valid semver: ${v}`)
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null }
}

const stringifySemver = ({ major, minor, patch, pre }) => {
  const base = `${major}.${minor}.${patch}`
  return pre ? `${base}-${pre}` : base
}

const bump = (current, kind) => {
  const v = parseSemver(current)
  // A pre-release bump just drops the pre tag and increments the base
  // segment per kind.
  if (kind === 'major') return stringifySemver({ major: v.major + 1, minor: 0, patch: 0, pre: null })
  if (kind === 'minor')
    return stringifySemver({ major: v.major, minor: v.minor + 1, patch: 0, pre: null })
  if (kind === 'patch')
    return stringifySemver({ major: v.major, minor: v.minor, patch: v.patch + 1, pre: null })
  throw new Error(`unknown bump kind: ${kind}`)
}

const current = readJson(SOURCE_OF_TRUTH).version
const isExplicit = /^\d+\.\d+\.\d+/.test(arg) && !/^(patch|minor|major)$/.test(arg)
const next = isExplicit ? (parseSemver(arg), arg) : bump(current, arg)

// Walk packages/ and write the bumped version to each package.json. Skip
// anything not directly under packages/ (e.g. nested dist files).
const writeAll = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (!statSync(path).isDirectory()) continue
    const pkgPath = join(path, 'package.json')
    try {
      const pkg = readJson(pkgPath)
      // Don't touch private packages (playground, fixtures).
      if (pkg.private === true) continue
      pkg.version = next
      writeJson(pkgPath, pkg)
      console.error(`  ${pkg.name} ${current} → ${next}`)
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
  }
}

console.error(`bumping ${current} → ${next}`)
writeAll(PACKAGES_DIR)
// Print just the new version to stdout for shell capture.
console.log(next)
