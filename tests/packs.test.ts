import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { validatePack } from '../src/engine/validator';
import { PACK_LIST, PACKS } from '../src/engine/packs';
import { collectSignoffs } from '../src/engine/signoff';
import { aclPack, clone } from './helpers';

describe('pack validator (Phase 1.5)', () => {
  it('all shipped packs are valid', () => {
    expect(PACK_LIST.map((p) => p.id).sort()).toEqual(['acl-reconstruction', 'rotator-cuff-repair', 'total-knee-replacement']);
    for (const p of PACK_LIST) expect(validatePack(p)).toEqual([]);
  });
  it('rejects a pack with no warning signs', () => {
    const p = clone(aclPack());
    p.warningSigns = [];
    expect(validatePack(p).join('|')).toContain('no warning signs');
  });
  it('rejects a pack with no SAFETY-tier sign', () => {
    const p = clone(aclPack());
    p.warningSigns.forEach((s) => (s.tier = 'REVIEW'));
    expect(validatePack(p).join('|')).toContain('SAFETY');
  });
  it('rejects overlapping phases', () => {
    const p = clone(aclPack());
    p.phases[1].order = p.phases[0].order;
    expect(validatePack(p).join('|')).toContain('overlapping phases');
    const q = clone(aclPack());
    q.phases[1].id = q.phases[0].id;
    expect(validatePack(q).join('|')).toContain('overlapping phases');
  });
  it('rejects a rule pointing to an unknown measure', () => {
    const p = clone(aclPack());
    (p.rules.find((r) => r.id === 'A1') as any).measure = 'doesNotExist';
    expect(validatePack(p).join('|')).toContain('unknown measure');
    const q = clone(aclPack());
    q.gates[0].criteria[0].measure = 'nope';
    expect(validatePack(q).join('|')).toContain('unknown measure');
  });
  it('rejects a threshold without a source tag', () => {
    const p = clone(aclPack());
    (p.rules.find((r) => r.id === 'R3') as any).stages[0].source = '';
    expect(validatePack(p).join('|')).toContain('without a source tag');
    const q = clone(aclPack());
    (q.rules.find((r) => r.id === 'A1') as any).deltaSource = '  ';
    expect(validatePack(q).join('|')).toContain('without a source tag');
    const g = clone(aclPack());
    g.gates[0].criteria[0].source = '';
    expect(validatePack(g).join('|')).toContain('no source tag');
  });
  it('rejects overlapping threshold stages, bad gates, belowCurve without a curve', () => {
    const p = clone(aclPack());
    (p.rules.find((r) => r.id === 'R3') as any).stages[0].maxWeek = 5;
    expect(validatePack(p).join('|')).toContain('overlapping stages');
    const q = clone(aclPack());
    q.gates.push(clone(q.gates[0]));
    expect(validatePack(q).join('|')).toContain('overlapping gates');
    const c = clone(PACKS['total-knee-replacement']);
    c.expectedCurves = c.expectedCurves.filter((x) => x.measure !== 'flexionDeg');
    expect(validatePack(c).join('|')).toContain('needs an expectedCurve');
  });
  it('rejects patient-facing text without Hindi', () => {
    const p = clone(aclPack());
    p.warningSigns[0].label.hi = '';
    expect(validatePack(p).join('|')).toContain('en and hi');
  });
});

describe('NEEDS_PHYSIO_SIGNOFF (rule 3)', () => {
  it('the knee-replacement and rotator-cuff packs carry the tag on every clinical number', () => {
    for (const id of ['total-knee-replacement', 'rotator-cuff-repair']) {
      const items = collectSignoffs(PACKS[id]);
      expect(items.length).toBeGreaterThan(10);
      // Shared core red-flag tier mappings (source SAFETY) are the project-wide safety rule, not new clinical numbers.
      const stray = items.filter((x) => !x.needsSignoff && !(x.where.includes('warning sign') && x.source === 'SAFETY'));
      expect(stray.map((x) => x.where)).toEqual([]);
    }
  });
  it('ACL placeholders we introduced are tagged', () => {
    const items = collectSignoffs(aclPack()).filter((x) => x.needsSignoff).map((x) => x.where);
    expect(items.some((w) => w.includes('R3'))).toBe(true);
    expect(items.some((w) => w.includes('numbness'))).toBe(true);
    expect(items.some((w) => w.includes('responseHours.SAFETY'))).toBe(true);
  });
});

describe('non-negotiable rules, enforced in code', () => {
  const engineFiles = readdirSync('src/engine').filter((f) => f.endsWith('.ts'));
  it('rule 1: no network or LLM access in the engine or voice parser', () => {
    for (const f of [...engineFiles.map((x) => 'src/engine/' + x), 'src/voice/parser.ts']) {
      const s = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(/fetch\s*\(|XMLHttpRequest|anthropic|openai|WebSocket|sendBeacon/i.test(s)).toBe(false);
    }
  });
  it('the rule engine has no condition-specific code', () => {
    for (const f of ['triage.ts', 'gates.ts', 'measures.ts', 'validator.ts']) {
      const s = readFileSync('src/engine/' + f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(/knee|\bacl\b|shoulder|flexion|extensionDeficit|\bpain\b|swelling|tsk/i.test(s)).toBe(false);
    }
  });
});

describe('README lists every NEEDS_PHYSIO_SIGNOFF value (rule 3)', () => {
  it('each placeholder appears in README.md', () => {
    const readme = readFileSync('README.md', 'utf8');
    for (const p of PACK_LIST) {
      for (const i of collectSignoffs(p).filter((x) => x.needsSignoff)) {
        expect(readme.includes('| ' + i.where.replace(p.id + ': ', '') + ' |')).toBe(true);
      }
    }
  });
});
