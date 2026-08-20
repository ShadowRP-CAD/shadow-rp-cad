import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { classifyEmergency, generateDispatchSpeech } from '../src/aiDispatch.js';

const originalFetch = global.fetch;
const originalKey = config.openAiApiKey;

afterEach(() => {
  global.fetch = originalFetch;
  config.openAiApiKey = originalKey;
});

describe('Shadow AI Dispatch', () => {
  it('validates structured AI output against the live unit roster', async () => {
    config.openAiApiKey = 'test-openai-key';
    global.fetch = async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify({
      title: 'Reported shots fired', summary: 'Caller heard three shots.', priority: 'P0', callType: 'WEAPONS', tenCode: '10-71',
      agencies: ['LEO', 'EMS'], assignedCallsigns: ['1-L-12', 'FAKE-9'],
      radioText: 'Shadow Dispatch. 10-71, shots fired, grid zero five zero, zero six zero. 1-L-12 respond.', confidence: 0.91
    }) }) });
    const result = await classifyEmergency({ callerName: 'Caller', locationGrid: '050 060', description: 'Three shots heard', serviceType: 'POLICE', worldX: 5000, worldZ: 6000 }, [
      { callsign: '1-L-12', agency: 'LEO', duty_status: '10-8', location_grid: '049 060', world_x: 4900, world_z: 6000 }
    ]);
    assert.equal(result.mode, 'OPENAI');
    assert.equal(result.tenCode, '10-71');
    assert.deepEqual(result.assignedCallsigns, ['1-L-12']);
  });

  it('returns generated MP3 bytes from the configured speech endpoint', async () => {
    config.openAiApiKey = 'test-openai-key';
    global.fetch = async () => ({ ok: true, arrayBuffer: async () => Uint8Array.from([73, 68, 51]).buffer });
    const audio = await generateDispatchSpeech('Shadow Dispatch test.');
    assert.deepEqual([...audio], [73, 68, 51]);
  });
});
