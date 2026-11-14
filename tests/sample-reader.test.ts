import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { GET } from "../app/api/sample-brief/[id]/route";
import { pool, setupPostgres } from "./postgres";
import { SAMPLES } from "../lib/samples";
import { sampleById } from "../lib/sample-articles";
import { readSampleGlosses } from "../lib/sample-reader";
import { numberBlocks } from "../lib/article";
import { annotationMatchesSource } from "../lib/source-revision";

before(setupPostgres);
after(() => pool.end());

test("a signed-out reader can request a cited summary and open two passage answers per example", async () => {
  assert.equal(SAMPLES.length, 12);
  const counts = new Map<string, number>();
  for (const sample of SAMPLES) {
    counts.set(sample.topic, (counts.get(sample.topic) ?? 0) + 1);
    const article = sampleById(sample.id);
    assert.ok(article);
    const args = { params: Promise.resolve({ id: sample.id }) };
    const response = await GET(new Request("http://localhost/api/sample-brief/" + sample.id), args);
    assert.equal(response.status, 200, sample.id);
    const { brief } = await response.json();
    const paragraphs = [...numberBlocks(article.blocks).values()];
    assert.ok(brief.gist.length > 50);
    assert.ok(brief.claims.length >= 2);
    assert.ok(brief.sections.length >= 2);
    for (const claim of [...brief.claims, ...brief.caveats]) {
      assert.ok(claim.cite === 0 || paragraphs.includes(claim.cite), sample.id);
    }
    for (const section of brief.sections) assert.ok(paragraphs.includes(section.start), sample.id);

    const questions = await readSampleGlosses(sample.id);
    assert.equal(questions.length, 2, sample.id);
    assert.notEqual(questions[0].anchor?.start.b, questions[1].anchor?.start.b);
    for (const question of questions) {
      assert.equal(question.articleId, sample.id);
      assert.ok(question.anchor && annotationMatchesSource(question, article), sample.id);
      const answer = question.turns[0].content;
      const citations = [...answer.matchAll(/\[¶(\d+)\]/g)];
      assert.ok(citations.length && citations.every(([, n]) => paragraphs.includes(Number(n))), sample.id);
    }
  }
  assert.deepEqual(Object.fromEntries(counts), { philosophy: 2, economics: 2, ai: 2, distribution: 2, mind: 2, science: 2 });
});

test("the public summary route does not resolve private or retired article ids", async () => {
  assert.ok(sampleById("on-a-piece-of-chalk"), "old notes can still open their original text");
  for (const id of ["private-article", "on-a-piece-of-chalk"]) {
    const response = await GET(new Request("http://localhost/api/sample-brief/" + id), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 404);
  }
});
