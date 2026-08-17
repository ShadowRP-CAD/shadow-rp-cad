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
    const people = await agent.get('/api/cad/civilian/lookup?name=Night').expect(200);
    assert.equal(people.body.results[0].alias, 'Night');
    const vehicles = await agent.get('/api/cad/vehicle/lookup?plate=SRP').expect(200);
    assert.equal(vehicles.body.results[0].plate, 'SRP-104');
  });

  it('creates alias-only roleplay personas', async () => {
    const created = await agent.post('/api/characters').send({ alias: 'Cipher', dob: '1998-08-17', gender: 'Unspecified' }).expect(201);
    assert.equal(created.body.alias, 'Cipher');
    assert.equal(created.body.last_name, '');
  });

  it('persists virtual stock purchases and portfolio balances', async () => {
    const market = await agent.get('/api/market').expect(200);
    assert.equal(market.body.assets.length, 6);
    const bought = await agent.post('/api/market/trade').send({ symbol: 'SHDW', side: 'BUY', quantity: 3 }).expect(201);
    assert.equal(bought.body.holdings.find(item => item.symbol === 'SHDW').quantity, 3);
    assert.ok(bought.body.account.cash < market.body.account.cash);
  });

  it('gives administrators complete oversight and protected edit controls', async () => {
    const overview = await agent.get('/api/admin/overview').expect(200);
    assert.ok(overview.body.counts.users >= 1);
    assert.ok(overview.body.logs.some(log => log.action === 'MARKET_ORDER'));
    const persona = overview.body.characters.find(item => item.alias === 'Cipher');
    const edited = await agent.patch(`/api/admin/characters/${persona.id}`).send({ alias: 'Cipher Prime', dob: persona.dob, gender: persona.gender, driverLicense: 'SUSPENDED' }).expect(200);
    assert.equal(edited.body.alias, 'Cipher Prime');
    assert.equal(edited.body.driver_license, 'SUSPENDED');
  });

  it('prevents an administrator from removing their own access', async () => {
    const me = await agent.get('/api/me').expect(200);
    await agent.patch(`/api/admin/users/${me.body.user.id}`).send({ role: 'CIVILIAN' }).expect(400);
  });
});
