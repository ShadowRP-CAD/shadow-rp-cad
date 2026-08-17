import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.DEV_AUTH = 'true';
process.env.INTERNAL_API_KEY = 'test-key';
process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-for-tests';

const { createDatabase, seedDatabase } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');

describe('Shadow RP CAD API', () => {
  let db, app, agent;
  before(() => {
    db = createDatabase(':memory:');
    seedDatabase(db);
    app = createApp(db).app;
    agent = request.agent(app);
  });
  after(() => db.close());

  it('reports health', async () => {
    const response = await request(app).get('/api/health').expect(200);
    assert.equal(response.body.ok, true);
  });

  it('rejects internal calls without a key', async () => {
    await request(app).post('/api/link/generate').send({ reforgerUid: 'x', playerName: 'Player' }).expect(401);
  });

  it('generates and verifies a one-time link code', async () => {
    const generated = await request(app).post('/api/link/generate').set('x-api-key', 'test-key')
      .send({ reforgerUid: 'reforger-123', playerName: 'Test Player' }).expect(201);
    assert.match(generated.body.token, /^[A-Z0-9]{6}$/);
    await agent.get('/auth/dev').expect(302);
    const linked = await agent.post('/api/link/verify').send({ token: generated.body.token, steamId: '76561198000000000' }).expect(200);
    assert.equal(linked.body.reforgerUid, 'reforger-123');
    await agent.post('/api/link/verify').send({ token: generated.body.token }).expect(400);
  });

  it('ingests calls and returns the dispatch dashboard', async () => {
    await request(app).post('/api/cad/call911').set('x-api-key', 'test-key').send({
      callerName: 'Pat Doe', locationGrid: '050 060', description: 'Vehicle collision', worldX: 5000, worldZ: 6000
    }).expect(201);
    const dashboard = await agent.get('/api/cad/dashboard').expect(200);
    assert.ok(dashboard.body.calls.some(call => call.description === 'Vehicle collision'));
  });

  it('finds seeded people and vehicles', async () => {
    const people = await agent.get('/api/cad/civilian/lookup?name=Mercer').expect(200);
    assert.equal(people.body.results[0].last_name, 'Mercer');
    const vehicles = await agent.get('/api/cad/vehicle/lookup?plate=SRP').expect(200);
    assert.equal(vehicles.body.results[0].plate, 'SRP-104');
  });
});
