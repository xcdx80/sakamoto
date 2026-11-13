#!/usr/bin/env python3
"""Validate the InView frameworks library.

Usage: python tools/validate.py [--root frameworks/] [--raw path/to/raw]
--raw points at the fetched data (posts_index.json, web_posts.json, web/*.txt). When it is given (or found at
../raw next to the library), every example is checked to be a verbatim excerpt of what was fetched.
Exit code 0 = all checks passed.
"""
import argparse, json, re, sys
from pathlib import Path
import yaml
from jsonschema import Draft202012Validator

def main():
    ap = argparse.ArgumentParser()
    here = Path(__file__).resolve().parent.parent
    ap.add_argument('--root', default=str(here))
    ap.add_argument('--raw', default=None)
    a = ap.parse_args()
    root = Path(a.root)
    raw = Path(a.raw) if a.raw else (root.parent / 'raw' if (root.parent / 'raw' / 'posts_index.json').exists() else None)
    errors, warns, stats = [], [], {}
    def err(m): errors.append(m)

    schema = json.loads((root / 'schema.json').read_text())
    Draft202012Validator.check_schema(schema)
    def validator(defname=None):
        if defname is None: return Draft202012Validator(schema)
        sub = {'$schema': schema['$schema'], '$defs': schema['$defs'], **schema['$defs'][defname]}
        return Draft202012Validator(sub)

    docs = {}
    for f in sorted(root.rglob('*.yaml')):
        rel = f.relative_to(root).as_posix()
        try: docs[rel] = yaml.safe_load(f.read_text())
        except yaml.YAMLError as e: err(f'{rel}: YAML parse error: {e}')
    stats['yaml_files'] = len(docs)

    kind_of = {'hooks/hook-patterns.yaml': 'hooks_file', 'rubrics/shared.yaml': 'shared_rubric_file',
               'rubrics/selection.yaml': 'selection_file', 'platforms/x.yaml': 'platform_file',
               'platforms/linkedin.yaml': 'platform_file', 'sources.yaml': 'sources_file'}
    fws = {}
    for rel, d in docs.items():
        if rel.startswith(('short-form/', 'long-form/')):
            v = validator(); fws[rel] = d
        elif rel in kind_of: v = validator(kind_of[rel])
        else: err(f'{rel}: unexpected YAML file (no schema mapping)'); continue
        for e in sorted(v.iter_errors(d), key=lambda e: list(e.path)):
            err(f'{rel}: schema: {"/".join(map(str, e.path)) or "<root>"}: {e.message[:200]}')
    for k in kind_of:
        if k not in docs: err(f'missing {k}')

    sources = {s['id']: s for s in docs.get('sources.yaml', {}).get('sources', [])}
    hooks = {p['id'] for p in docs.get('hooks/hook-patterns.yaml', {}).get('patterns', [])}
    fw_ids = {d['id'] for d in fws.values()}

    def refs(obj, where):
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k == 'source_refs': yield from ((s, where) for s in v)
                elif k == 'source_ref': yield (v, where)
                else: yield from refs(v, where)
        elif isinstance(obj, list):
            for v in obj: yield from refs(v, where)
    for rel, d in docs.items():
        if rel == 'sources.yaml': continue
        for s, w in refs(d, rel):
            if s not in sources: err(f'{w}: source {s} not in sources.yaml')

    real_examples = 0
    for rel, d in fws.items():
        stem = Path(rel).stem
        if d.get('id') != stem: err(f'{rel}: id {d.get("id")} != filename {stem}')
        if d.get('form') != ('short' if rel.startswith('short-form/') else 'long'): err(f'{rel}: form does not match folder')
        for h in d.get('hook_patterns', []):
            if h['pattern'] not in hooks: err(f'{rel}: hook pattern {h["pattern"]} not in hooks/hook-patterns.yaml')
        for b in d.get('better_than', []):
            if b['framework'] not in fw_ids: err(f'{rel}: better_than {b["framework"]} is not a framework id')
            if b['framework'] == d['id']: err(f'{rel}: better_than itself')
        ex = d.get('examples', [])
        uses = [e for e in ex if e.get('fit') in ('exact', 'partial')]
        real_examples += len(ex)
        if len(uses) < 2 and not d.get('needs_examples'):
            err(f'{rel}: fewer than 2 real (exact/partial) examples but needs_examples is false')
        if d.get('needs_examples') and len([e for e in ex if e.get('fit') == 'exact']) >= 2:
            warns.append(f'{rel}: needs_examples true but has 2+ exact examples')
        L = d.get('length', {})
        if L and L['min'] > L['max']: err(f'{rel}: length min > max')
        crit = [c['id'] for c in d['rubric']['criteria']]
        if len(crit) != len(set(crit)): err(f'{rel}: duplicate rubric criterion ids')
    stats['frameworks'] = len(fws); stats['examples_in_frameworks'] = real_examples

    sel = docs.get('rubrics/selection.yaml', {})
    for c in sel.get('comparisons', []):
        for k in ('prefer', 'over'):
            if c[k] not in fw_ids: err(f'selection.yaml: comparison {k}={c[k]} unknown')
    m = sel.get('matrix', {})
    for rel, d in fws.items():
        row = m.get(d['id'])
        if not row: err(f'selection.yaml: matrix missing {d["id"]}'); continue
        want = {s['signal']: s['weight'] for s in d['when_to_use']['source_signals']}
        if row['signals'] != want or row['goals'] != d['when_to_use']['goals']:
            err(f'selection.yaml: matrix row {d["id"]} out of date (rebuild)')
    if set(m) - fw_ids: err(f'selection.yaml: matrix has unknown ids {sorted(set(m) - fw_ids)}')
    hk = docs.get('hooks/hook-patterns.yaml', {})
    used = {h['pattern'] for d in fws.values() for h in d['hook_patterns']}
    for p in hk.get('patterns', []):
        if p['id'] not in used: warns.append(f'hooks: pattern {p["id"]} not used by any framework')

    shared = docs.get('rubrics/shared.yaml', {})
    for r in shared.get('lint', {}).get('ai_tells', []) + shared.get('lint', {}).get('other', []):
        try: re.compile(r['pattern'], re.I | re.M)
        except re.error as e: err(f'shared.yaml: lint {r["id"]} bad regex: {e}')
    need = {'hook-strength', 'specific-payoff', 'rate-of-revelation', 'readability-1-3-1', 'grounded-in-sources', 'link-handling', 'no-ai-tells', 'clear-ending'}
    have = {c['id'] for c in shared.get('criteria', [])}
    if need - have: err(f'shared.yaml: missing criteria {sorted(need - have)}')

    # Lint our own prose (summaries, notes) with the fail-severity AI-tell rules.
    fail_rules = [re.compile(r['pattern'], re.I) for r in shared.get('lint', {}).get('ai_tells', []) if r.get('severity') == 'fail']
    for rel, d in fws.items():
        prose = ' '.join([d['summary'], d['when_to_use'].get('notes', '')] + [s['purpose'] for s in d['structure']])
        for rx in fail_rules:
            if rx.search(prose): warns.append(f'{rel}: prose matches AI-tell /{rx.pattern}/')

    if raw:
        idx = json.load(open(raw / 'posts_index.json'))['posts']
        web = json.load(open(raw / 'web_posts.json'))
        pages = {p.stem: p.read_text() for p in (raw / 'web').glob('*.txt')}
        def norm(s): return re.sub(r'[ \t]*\n[ \t]*', '\n', re.sub(r'[ \t]+', ' ', s))
        def segments(t):
            t = t.replace('[... posts omitted ...]', '\x00').replace('[next post]', '\x00')
            t = re.sub(r'(^|\n)\.\.\.(\n|$)', '\x00', t)
            return [s.strip() for s in t.split('\x00') if s.strip()]
        def all_examples():
            for rel, d in fws.items():
                for i, e in enumerate(d.get('examples', [])): yield rel, i, e
            for p in hk.get('patterns', []):
                for i, e in enumerate(p.get('examples', [])): yield f'hooks:{p["id"]}', i, e
        n = 0
        for rel, i, e in all_examples():
            sid = e['source_ref']; n += 1
            if sid.startswith('x-'):
                p = idx.get(sid[2:])
                if not p: err(f'{rel}#{i}: {sid} not in fetched posts'); continue
                corpus = [p.get('text') or '', p.get('article_text') or '', (p.get('article_title') or '').strip() + '\n\n' + (p.get('article_text') or '')]
                if e['kind'] == 'thread':
                    corpus += [q['text'] for q in idx.values() if q.get('author_id') == p.get('author_id')]
            elif sid.startswith('web-li-'):
                corpus = [web[sid[4:]]['text']]
            else:
                corpus = list(pages.values())
            for seg in segments(e['text']):
                parts = [s for s in seg.split('\n') if s.strip()] if sid.startswith('web-') and not sid.startswith('web-li-') else [seg]
                for part in parts:
                    if not any(norm(part.strip()) in norm(c) for c in corpus):
                        err(f'{rel}#{i}: text not verbatim in {sid}: {part[:80]!r}')
        stats['examples_checked_verbatim'] = n
        for sid in sources:
            if sid.startswith('x-') and sid[2:] not in idx: err(f'sources.yaml: {sid} not in fetched posts')
    else:
        warns.append('raw data not found: skipped verbatim example checks (pass --raw)')

    for w in warns: print('WARN ', w)
    for e in errors: print('ERROR', e)
    print(json.dumps(stats))
    print('OK' if not errors else f'FAILED: {len(errors)} error(s)')
    sys.exit(1 if errors else 0)

if __name__ == '__main__':
    main()
