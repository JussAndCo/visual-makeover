import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('PromptOS handoff contract remains advisory and evidence-only', async () => {
  const contract = JSON.parse(await readFile(new URL('../.control-room/promptos-handoff.contract.json', import.meta.url), 'utf8'));
  const server = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');

  assert.equal(contract.contractId, 'visual-makeover/promptos-handoff@v1');
  assert.equal(contract.status, 'active');
  assert.equal(contract.authority.mode, 'advisory-only');
  assert.equal(contract.authority.executionAuthorized, false);
  assert.equal(contract.authority.registrationAuthority, false);
  assert.equal(contract.authority.mayWidenBrowserGrant, false);
  assert.equal(contract.authority.mayMutateDestination, false);
  assert.equal(contract.authority.mayPublish, false);

  assert.equal(contract.evidence.requiredContract, 'juss/browser-reality@v1');
  assert.equal(contract.evidence.rawBrowserPayloadAllowed, false);
  assert.equal(contract.evidence.rawScreenshotBytesAllowed, false);
  assert.equal(contract.evidence.browserGrantTokenAllowed, false);
  assert.equal(contract.evidence.sessionTokenAllowed, false);

  for (const marker of [
    "contractId: 'visual-makeover/promptos-handoff@v1'",
    "status: 'draft'",
    "authority: 'advisory-only'",
    'executionAuthorized: false',
    'registrationAuthority: false',
    "browserRealityContract: 'juss/browser-reality@v1'",
    "PROMPTOS_HANDOFF_DRAFTED"
  ]) {
    assert.ok(server.includes(marker), `server missing handoff marker: ${marker}`);
  }

  assert.ok(!server.includes('browserGrantTokenAllowed: true'));
  assert.ok(!server.includes('sessionTokenAllowed: true'));
});
