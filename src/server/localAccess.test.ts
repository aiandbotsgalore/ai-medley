import assert from 'node:assert/strict';
import { getLocalAccessDenial, isAllowedLocalOrigin } from './localAccess';

assert.equal(isAllowedLocalOrigin(undefined), true);
assert.equal(isAllowedLocalOrigin('http://localhost:3000'), true);
assert.equal(isAllowedLocalOrigin('http://127.0.0.1:3000'), true);
assert.equal(isAllowedLocalOrigin('http://[::1]:3000'), true);

assert.equal(isAllowedLocalOrigin('https://localhost:3000'), false);
assert.equal(isAllowedLocalOrigin('http://localhost:4443'), false);
assert.equal(isAllowedLocalOrigin('https://example.com'), false);
assert.equal(isAllowedLocalOrigin('http://192.168.1.20:3000'), false);
assert.equal(isAllowedLocalOrigin('http://localhost.example.com:3000'), false);
assert.equal(isAllowedLocalOrigin('null'), false);
assert.equal(isAllowedLocalOrigin('not a URL'), false);

assert.equal(getLocalAccessDenial({
  method: 'POST',
  origin: 'http://localhost:3000',
  fetchSite: 'same-origin',
}), null);

assert.equal(getLocalAccessDenial({
  method: 'POST',
  origin: 'http://127.0.0.1:3000',
  fetchSite: 'same-site',
}), null);

assert.equal(getLocalAccessDenial({
  method: 'GET',
  origin: undefined,
  fetchSite: undefined,
}), null);

assert.equal(getLocalAccessDenial({
  method: 'POST',
  origin: 'https://example.com',
  fetchSite: 'cross-site',
}), 'Requests are only allowed from the local app.');

assert.equal(getLocalAccessDenial({
  method: 'DELETE',
  origin: undefined,
  fetchSite: 'cross-site',
}), 'Cross-site changes are not allowed.');

console.log('localAccess tests passed');
