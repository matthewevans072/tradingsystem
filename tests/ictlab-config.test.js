// ICT Lab configuration: the pins are the Part A commit's (read from the log, not retyped), the spec validator
// (every field known, every value in the allowed set, the shared block identical across the four files), the pin
// check on load, the window reader (the reserved window has no code path) and the log reader's row grammars.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './helpers.js';
import { PREREG, SPEC_SHA256, ROUND1_SPECS, PROTOCOL_PATH, CONCEPTS_PATH, SPEC_DIR, LOG_PATH, IL_DIR, fileSha256, textSha256, validateSpec, validateRound, sharedBlockOf, loadSpec, listSpecs, windowOf, WINDOWS, MAX_BAR_DATE, CODE_REVISION, ENGINE_VERSION, visibleText, parseEntries, logStatus, RUN_ENTRY, frozenTitle, VALIDATION_TITLE, preregCommitStatus, COMMITTED_PATHS, SOURCE_FILES, sourceHash, namesRevision } from '../server/ictlab/config.js';

test('the pins: the six pinned files on disk match the Part A values recorded in EXPERIMENT-LOG.md entry 1', () => {
  assert.equal(PREREG.commit, '00a2558c39cad16434bd79aedbc1b37cbae34916');
  assert.equal(fileSha256(PROTOCOL_PATH), PREREG.sha256['PROTOCOL.md']);
  assert.equal(fileSha256(CONCEPTS_PATH), PREREG.sha256['CONCEPTS.md']);
  for (const f of ROUND1_SPECS) assert.equal(fileSha256(path.join(SPEC_DIR, f)), SPEC_SHA256[f], f);
  // The log's approval note lists the same hashes.
  const log = fs.readFileSync(LOG_PATH, 'utf8');
  for (const h of Object.values(PREREG.sha256)) assert.ok(log.includes(h), `the log names ${h.slice(0, 12)}`);
  assert.ok(log.includes(PREREG.commit));
  assert.equal(CODE_REVISION, 'il-code-2026-11-04-1');
  assert.equal(ENGINE_VERSION, 'il-engine-1');
  assert.equal(MAX_BAR_DATE, '2022-12-30');
  assert.deepEqual(WINDOWS.development, { start: '2018-06-01', end: '2022-12-30' });
  assert.deepEqual(WINDOWS.validation, { start: '2023-01-03', end: '2024-12-31' });
  assert.deepEqual(WINDOWS.reserved, { start: '2025-01-01', end: '2026-06-30' });
  assert.ok(COMMITTED_PATHS.includes('server/ictlab') && COMMITTED_PATHS.includes('strategy/ict-lab/specs'));
  assert.ok(SOURCE_FILES.includes('server/ictlab/engine.js'));
  assert.match(sourceHash(), /^[0-9a-f]{64}$/);
});

test('windowOf: development and validation only; the reserved window has no code path', () => {
  assert.deepEqual(windowOf('development'), WINDOWS.development);
  assert.deepEqual(windowOf('validation'), WINDOWS.validation);
  assert.throws(() => windowOf('reserved'), /no code path/);
  assert.throws(() => windowOf('holdout'), /development or validation/);
});

test('validateSpec: the four files are valid; an unknown field, a value outside its set, a missing field, a wrong number relation or a changed window is refused', () => {
  const specs = ROUND1_SPECS.map((f) => JSON.parse(fs.readFileSync(path.join(SPEC_DIR, f), 'utf8')));
  for (const s of specs) assert.deepEqual(validateSpec(s), [], s.name);
  assert.deepEqual(validateRound(specs), []);
  const ob = specs.find((s) => s.name === 'ict-sweep-bos-ob');
  assert.ok(validateSpec({ ...ob, extra: 1 }).some((e) => /extra is not a known field/.test(e)));
  assert.ok(validateSpec({ ...ob, swing: { ...ob.swing, bias: 'on' } }).some((e) => /swing.bias is not a known field/.test(e)));
  assert.ok(validateSpec({ ...ob, side: 'short' }).some((e) => /side must be one of "long"/.test(e)));
  assert.ok(validateSpec({ ...ob, entry: { ...ob.entry, rounding: 'half_cent_up' } }).some((e) => /entry.rounding/.test(e)));
  assert.ok(validateSpec({ ...ob, entry: { ...ob.entry, zone: 'fair_value_gap' } }).some((e) => /entry.zone/.test(e)), 'the OB spec cannot name the FVG zone');
  const { costs, ...noCosts } = ob;
  assert.ok(validateSpec(noCosts).some((e) => /costs is missing/.test(e)));
  assert.ok(validateSpec({ ...ob, costs: { ...costs, perSide: 0.03 } }).some((e) => /perSide must equal/.test(e)));
  assert.ok(validateSpec({ ...ob, windows: { development: { start: '2018-06-01', end: '2024-12-31' } } }).some((e) => /windows.development must be/.test(e)));
  assert.ok(validateSpec({ ...ob, sweep: { ...ob.sweep, window: { firstBarIndex: 0, lastBarIndex: 18 } } }).some((e) => /must not exceed timeWindow.lastDecisionBarIndex/.test(e)));
  assert.ok(validateSpec({ ...ob, maxFilledTradesPerSession: 2 }).some((e) => /maxFilledTradesPerSession must be 1/.test(e)));
  assert.ok(validateSpec({ ...ob, name: 'ict-other' }).some((e) => /name must be one of/.test(e)));
  assert.ok(validateSpec({ ...ob, concepts: ['H1', 'H99'] }).some((e) => /concepts/.test(e)));
  assert.ok(validateSpec({ ...ob, stop: { ...ob.stop, bufferDollars: 'one cent' } }).some((e) => /stop.bufferDollars must be a finite/.test(e)));
  assert.ok(validateSpec({ ...ob, round: 2 }).some((e) => /round must be 1/.test(e)));
  // The shared block: a changed shared number in one file is caught against the others.
  const changed = specs.map((s) => (s.name === 'ict-ifvg' ? { ...s, stop: { ...s.stop, minDistanceDollars: 0.39 } } : s));
  assert.deepEqual(validateRound(changed), ['ict-ifvg: its shared block differs from ict-sweep-bos-fvg\'s']);
  assert.ok(Object.keys(sharedBlockOf(ob)).includes('account') && sharedBlockOf(ob).entry.price === 'zone_midpoint' && sharedBlockOf(ob).stop.minDistanceDollars === 0.40);
  assert.ok(!('anchor' in sharedBlockOf(ob).stop), 'the per-spec anchor is outside the shared block');
});

test('loadSpec refuses a pinned file that was edited, and listSpecs reports every file', () => {
  const dir = tempDir('il-cfg-');
  for (const f of ROUND1_SPECS) fs.copyFileSync(path.join(SPEC_DIR, f), path.join(dir, f));
  const s = loadSpec(path.join(dir, 'ict-ifvg-0.1.0.json'));
  assert.equal(s.name, 'ict-ifvg');
  assert.equal(s.hash, SPEC_SHA256['ict-ifvg-0.1.0.json']);
  assert.equal(s.file, 'ict-ifvg-0.1.0.json');
  assert.ok(Object.isFrozen(s));
  const text = fs.readFileSync(path.join(dir, 'ict-ifvg-0.1.0.json'), 'utf8');
  fs.writeFileSync(path.join(dir, 'ict-ifvg-0.1.0.json'), text.replace('"minDistanceDollars": 0.40', '"minDistanceDollars": 0.30'));
  assert.throws(() => loadSpec(path.join(dir, 'ict-ifvg-0.1.0.json')), /differs from its pinned SHA-256/);
  // CRLF line endings do not change the hash.
  fs.writeFileSync(path.join(dir, 'ict-ifvg-0.1.0.json'), text.replace(/\n/g, '\r\n'));
  assert.equal(loadSpec(path.join(dir, 'ict-ifvg-0.1.0.json')).hash, SPEC_SHA256['ict-ifvg-0.1.0.json']);
  fs.writeFileSync(path.join(dir, 'ict-new-0.1.0.json'), text.replace('"ict-ifvg"', '"ict-breaker"'));
  const list = listSpecs(dir);
  assert.equal(list.length, 5);
  assert.equal(list.filter((x) => x.round1).length, 4);
  const n = list.find((x) => x.file === 'ict-new-0.1.0.json');
  assert.equal(n.round1, false);
  assert.ok(n.error == null || /known field|must be/.test(n.error));
  assert.equal(textSha256('a\r\nb'), textSha256('a\nb'));
});

test('preregCommitStatus with a scripted git: the commit must exist, be an ancestor and hold every pinned file with its hash', () => {
  const files = Object.fromEntries(Object.keys(PREREG.sha256).map((n) => [n, fs.readFileSync(path.join(IL_DIR, n), 'utf8')]));
  const git = (behaviour) => (args) => {
    if (args[0] === 'cat-file') { if (behaviour.missing) throw new Error('no'); return ''; }
    if (args[0] === 'merge-base') { if (behaviour.notAncestor) throw new Error('no'); return ''; }
    if (args[0] === 'show') { const name = args[1].split('strategy/ict-lab/')[1]; if (behaviour.drop === name) throw new Error('no'); return behaviour.alter === name ? `${files[name]}x` : files[name]; }
    if (args[0] === 'log') return '2026-11-04T06:21:01-06:00';
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const ok = preregCommitStatus({ git: git({}) });
  assert.equal(ok.ok, true, ok.detail);
  assert.match(ok.detail, /holds the 6 pinned files/);
  assert.equal(ok.committedAt, '2026-11-04T06:21:01-06:00');
  assert.match(preregCommitStatus({ git: git({ missing: true }) }).detail, /not in this repository/);
  assert.match(preregCommitStatus({ git: git({ notAncestor: true }) }).detail, /not an ancestor/);
  assert.match(preregCommitStatus({ git: git({ drop: 'CONCEPTS.md' }) }).detail, /does not hold strategy\/ict-lab\/CONCEPTS.md/);
  assert.match(preregCommitStatus({ git: git({ alter: 'specs/ict-ifvg-0.1.0.json' }) }).detail, /ict-ifvg-0.1.0.json does not have the pinned SHA-256/);
});

test('the log reader: entries outside fences and comments; the code-frozen, Run and Validation authorized grammars', () => {
  const dir = tempDir('il-cfg-');
  const file = path.join(dir, 'EXPERIMENT-LOG.md');
  const H = 'a'.repeat(64), SPEC = 'ict-ifvg-0.1.0.json', C = PREREG.commit;
  assert.equal(visibleText('x ```\nhidden\n``` y <!-- gone --> z'), 'x  y  z');
  assert.deepEqual(parseEntries('## 1 | 2026-11-04 | **T**\n\nbody\n## 2 | 2026-11-05 | other\n').map((e) => [e.number, e.title]), [[1, '**T**'], [2, 'other']]);
  assert.equal(logStatus(path.join(dir, 'none.md')).exists, false);
  // The frozen entry must name the revision (as a whole token), the commit and a data hash.
  fs.writeFileSync(file, `# log\n\n## 1 | 2026-11-04 | **${frozenTitle(1)}**\n\nCode ${CODE_REVISION}; commit ${C}; data hash: ${H}.\n`);
  const ok = logStatus(file);
  assert.deepEqual(ok.frozen, { number: 1, date: '2026-11-04', codeRevision: CODE_REVISION, dataHash: H });
  assert.equal(ok.nextNumber, 2);
  assert.equal(ok.validation.authorized, false);
  assert.match(ok.validation.problem, /no entry titled/);
  fs.writeFileSync(file, `# log\n\n## 1 | 2026-11-04 | **${frozenTitle(1)}**\n\nCode ${CODE_REVISION}-old; commit ${C}; data hash: ${H}.\n`);
  assert.match(logStatus(file).frozenProblem, /does not name the current code revision/);
  assert.equal(namesRevision(`x ${CODE_REVISION}-old y`), false);
  assert.equal(namesRevision(`x ${CODE_REVISION} y`), true);
  fs.writeFileSync(file, `# log\n\n\`\`\`\n## 1 | 2026-11-04 | **${frozenTitle(1)}**\n\nCode ${CODE_REVISION}; commit ${C}; data hash: ${H}.\n\`\`\`\n`);
  assert.match(logStatus(file).frozenProblem, /no entry titled/, 'an entry inside a code fence is not read');
  fs.writeFileSync(file, `# log\n\n<!--\n## 1 | 2026-11-04 | **${frozenTitle(1)}**\n\nCode ${CODE_REVISION}; commit ${C}; data hash: ${H}.\n-->\n`);
  assert.match(logStatus(file).frozenProblem, /no entry titled/, 'an entry inside an HTML comment is not read');
  fs.writeFileSync(file, `# log\n\n## 1 | 2026-11-04 | **${frozenTitle(1)}**\n\nCode ${CODE_REVISION}; commit ${C}; data hash: ${H}.\n## 2 | 2026-11-04 | **${frozenTitle(1)}**\n\nCode ${CODE_REVISION}; commit ${C}; data hash: ${H}.\n`);
  assert.match(logStatus(file).frozenProblem, /2 .* entries name the current code revision/);
  // Run entries: the exact form, else malformed.
  const good = `## 3 | 2026-11-05 | **Run** run id: 1, spec: ${SPEC}, spec hash: ${H}, window: development, status: done`;
  assert.match(good.replace(/^## 3 \| 2026-11-05 \| /, ''), RUN_ENTRY);
  fs.writeFileSync(file, `# log\n\n${good}\n\ntext\n## 4 | 2026-11-05 | **Run** run id: 2 without the rest\n\n## 5 | 2026-11-05 | a note that says run id: 3\n\n## 6 | 2026-11-05 | **Run** run id: 7, spec: ${SPEC}, spec hash: ${H}, window: reserved, status: done\n`);
  const ls = logStatus(file);
  assert.deepEqual(ls.runs, [{ number: 3, runId: 1, spec: SPEC, specHash: H, window: 'development', status: 'done' }]);
  assert.deepEqual(ls.malformed.map((m) => m.number), [4, 5, 6], 'a reserved-window row is malformed');
  // The owner's validation row: exactly one, naming the revision, quoting the owner, naming a spec file.
  const v = (body) => `## 9 | 2026-11-06 | **${VALIDATION_TITLE}**\n\n${body}\n`;
  fs.writeFileSync(file, `# log\n\n${v(`> validate ${SPEC} once\n\nCode revision ${CODE_REVISION}.`)}`);
  const va = logStatus(file, { specFile: SPEC }).validation;
  assert.equal(va.authorized, true);
  assert.deepEqual(va.specs, [SPEC]);
  assert.equal(logStatus(file, { specFile: 'ict-breaker-0.1.0.json' }).validation.authorized, false, 'a spec the row does not name');
  fs.writeFileSync(file, `# log\n\n${v(`validate ${SPEC} once; code revision ${CODE_REVISION}.`)}`);
  assert.match(logStatus(file).validation.problem, /does not quote the owner/);
  fs.writeFileSync(file, `# log\n\n${v(`> validate ${SPEC} once\n\nCode revision il-code-2000-01-01-1.`)}`);
  assert.match(logStatus(file).validation.problem, /does not name the current code revision/);
  fs.writeFileSync(file, `# log\n\n${v(`> validate once\n\nCode revision ${CODE_REVISION}.`)}`);
  assert.match(logStatus(file).validation.problem, /names no spec file/);
  fs.writeFileSync(file, `# log\n\n${v(`> validate ${SPEC}\n\n${CODE_REVISION}`)}${v(`> again ${SPEC}\n\n${CODE_REVISION}`).replace('## 9', '## 10')}`);
  assert.match(logStatus(file).validation.problem, /2 .* entries/);
  fs.writeFileSync(file, `# log\n\n<!--\n${v(`> validate ${SPEC}\n\n${CODE_REVISION}`)}-->\n`);
  assert.equal(logStatus(file).validation.authorized, false, 'a row inside a comment is not read');
});
