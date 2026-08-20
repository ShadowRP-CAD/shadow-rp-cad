import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.DEV_AUTH = 'true';
process.env.INTERNAL_API_KEY = 'test-key';
process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-for-tests';

const { createDatabase, seedDatabase } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { normalizeSunoClips } = await import('../src/suno.js');

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

  it('repeats the active code until the Reforger identity is linked', async () => {
    const first = await request(app).post('/api/link/onboarding').set('x-api-key', 'test-key')
      .send({ reforgerUid: 'new-player-777', playerName: 'Ghost' }).expect(201);
    assert.equal(first.body.showPrompt, true);
    assert.match(first.body.token, /^[A-Z0-9]{6}$/);
    const reconnect = await request(app).post('/api/link/onboarding').set('x-api-key', 'test-key')
      .send({ reforgerUid: 'new-player-777', playerName: 'Ghost' }).expect(200);
    assert.equal(reconnect.body.showPrompt, true);
    assert.equal(reconnect.body.token, first.body.token);
  });

  it('accepts Enfusion RestContext JSON sent with a form content type', async () => {
    const response = await request(app)
      .post('/api/link/onboarding')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(JSON.stringify({
        apiKey: 'test-key',
        reforgerUid: 'enfusion-player-888',
        playerName: 'Reforger Player'
      }))
      .expect(201);
    assert.equal(response.body.showPrompt, true);
    assert.match(response.body.token, /^[A-Z0-9]{6}$/);
  });

  it('ingests calls and returns the dispatch dashboard', async () => {
    const dispatched = await request(app).post('/api/cad/call911').set('x-api-key', 'test-key').send({
      callerName: 'Pat Doe', locationGrid: '050 060', description: 'Vehicle collision', worldX: 5000, worldZ: 6000
    }).expect(201);
    assert.equal(dispatched.body.ten_code, '10-50');
    assert.equal(dispatched.body.call_type, 'TRAFFIC');
    assert.match(dispatched.body.dispatch_text, /grid/i);
    assert.equal(dispatched.body.ai_mode, 'SAFE_FALLBACK');
    assert.deepEqual(dispatched.body.assigned_units, ['1-L-12']);
    const dashboard = await agent.get('/api/cad/dashboard').expect(200);
    assert.ok(dashboard.body.calls.some(call => call.description === 'Vehicle collision'));
    assert.ok(Array.isArray(dashboard.body.bolos));
  });

  it('normalizes and protects the public Shadow Radio catalog', () => {
    const tracks = normalizeSunoClips([
      { id: 'track-1', title: 'Shadow Anthem', audio_url: 'https://cdn1.suno.ai/track-1.mp3', display_name: 'Playa' },
      { id: 'track-1', title: 'Duplicate', audio_url: 'https://cdn1.suno.ai/track-1.mp3' },
      { id: 'unsafe', title: 'Unsafe', audio_url: 'javascript:alert(1)' }
    ]);
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].title, 'Shadow Anthem');
    assert.equal(tracks[0].page, 'https://suno.com/song/track-1');
  });

  it('runs the advanced incident command workflow', async () => {
    const created = await agent.post('/api/cad/calls').send({
      callTitle: 'Armed suspect perimeter', callerName: 'Dispatch', locationGrid: '051 061',
      description: 'Units requested for containment and contact.', priority: 'P0', callType: 'WEAPONS'
    }).expect(201);
    assert.equal(created.body.priority, 'P0');
    assert.equal(created.body.call_type, 'WEAPONS');
    const assigned = await agent.patch(`/api/cad/calls/${created.body.id}`).send({
      status: 'DISPATCHED', assignedUnits: ['1-L-12'], priority: 'P0'
    }).expect(200);
    assert.ok(assigned.body.events.some(event => event.event_type === 'UNIT_ASSIGNED'));
    const noted = await agent.post(`/api/cad/calls/${created.body.id}/notes`).send({ note: 'Perimeter established on the east road.' }).expect(201);
    assert.equal(noted.body.events[0].event_type, 'NOTE');
    const unit = await agent.patch('/api/cad/units/demo-unit-1').send({ dutyStatus: '10-6' }).expect(200);
    assert.equal(unit.body.duty_status, '10-6');
  });

  it('creates BOLO alerts and searches every records system', async () => {
    const bolo = await agent.post('/api/cad/bolos').send({
      boloType: 'PERSON', subject: 'Night', description: 'Wanted for interview', priority: 'P1', locationGrid: '044 064'
    }).expect(201);
    assert.equal(bolo.body.status, 'ACTIVE');
    const search = await agent.get('/api/cad/global-search?q=Night').expect(200);
    assert.ok(search.body.people.some(person => person.alias === 'Night'));
    assert.ok(search.body.bolos.some(item => item.subject === 'Night'));
    const located = await agent.patch(`/api/cad/bolos/${bolo.body.id}`).send({ status: 'LOCATED' }).expect(200);
    assert.equal(located.body.status, 'LOCATED');
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

  it('uses the live ATM Bank Manager balance for stock purchases', async () => {
    const synced = await request(app).post('/api/economy/atm-sync').set('x-api-key', 'test-key').send({
      reforgerUid: 'reforger-123', playerName: 'ShadowDispatch', bankBalance: 43210
    }).expect(200);
    assert.equal(synced.body.linked, true);
    assert.equal(synced.body.balance, 43210);
    const market = await agent.get('/api/market').expect(200);
    assert.equal(market.body.assets.length, 6);
    assert.equal(market.body.account.cash, 43210);
    assert.equal(market.body.account.bankSource, 'ATM_BANK_MANAGER');
    const bought = await agent.post('/api/market/trade').send({ symbol: 'SHDW', side: 'BUY', quantity: 3 }).expect(201);
    assert.equal(bought.body.holdings.find(item => item.symbol === 'SHDW').quantity, 3);
    assert.ok(bought.body.account.cash < market.body.account.cash);
    const applied = await request(app).post('/api/economy/atm-sync').set('x-api-key', 'test-key').send({
      reforgerUid: 'reforger-123', playerName: 'ShadowDispatch', bankBalance: 43210
    }).expect(200);
    assert.equal(applied.body.apply, true);
    assert.equal(applied.body.balance, bought.body.account.cash);
    const acknowledged = await request(app).post('/api/economy/atm-sync').set('x-api-key', 'test-key').send({
      reforgerUid: 'reforger-123', playerName: 'ShadowDispatch', bankBalance: applied.body.balance
    }).expect(200);
    assert.equal(acknowledged.body.apply, false);
  });

  it('persists linked civilian property, business, and government services', async () => {
    await agent.post('/api/civilian/properties').send({ propertyName: 'Harbor Loft', propertyType: 'Residence', locationGrid: '041 062', declaredValue: 85000 }).expect(201);
    await agent.post('/api/civilian/businesses').send({ businessName: 'Cipher Logistics', category: 'Transport & Logistics' }).expect(201);
    await agent.post('/api/civilian/requests').send({ requestType: 'Business License', title: 'Operating permit', details: 'Application for commercial logistics operations.' }).expect(201);
    const portal = await agent.get('/api/civilian/portal').expect(200);
    assert.equal(portal.body.linked, true);
    assert.equal(portal.body.properties[0].property_name, 'Harbor Loft');
    assert.equal(portal.body.businesses[0].business_name, 'Cipher Logistics');
    assert.equal(portal.body.requests[0].status, 'SUBMITTED');
    assert.ok(portal.body.transactions.some(entry => entry.transaction_type === 'STOCK_PURCHASE'));
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
