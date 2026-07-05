import assert from "node:assert/strict";
import {
  getLocalAccessDenial,
  isAllowedLocalHost,
  isAllowedLocalOrigin,
} from "./localAccess";

assert.equal(isAllowedLocalOrigin(undefined), true);
assert.equal(isAllowedLocalOrigin("http://localhost:3000"), true);
assert.equal(isAllowedLocalOrigin("http://127.0.0.1:3000"), true);
assert.equal(isAllowedLocalOrigin("http://[::1]:3000"), true);

assert.equal(isAllowedLocalOrigin("https://localhost:3000"), false);
assert.equal(isAllowedLocalOrigin("http://localhost:4443"), false);
assert.equal(isAllowedLocalOrigin("https://example.com"), false);
assert.equal(isAllowedLocalOrigin("http://192.168.1.20:3000"), false);
assert.equal(isAllowedLocalOrigin("http://localhost.example.com:3000"), false);
assert.equal(isAllowedLocalOrigin("null"), false);
assert.equal(isAllowedLocalOrigin("not a URL"), false);
assert.equal(isAllowedLocalHost("localhost:3000"), true);
assert.equal(isAllowedLocalHost("127.0.0.1:3000"), true);
assert.equal(isAllowedLocalHost("[::1]:3000"), true);
assert.equal(isAllowedLocalHost("localhost:4443"), false);
assert.equal(isAllowedLocalHost("evil.test:3000"), false);
assert.equal(isAllowedLocalHost(undefined), false);

assert.equal(
  getLocalAccessDenial({
    method: "POST",
    origin: "http://localhost:3000",
    fetchSite: "same-origin",
    host: "localhost:3000",
  }),
  null,
);

assert.equal(
  getLocalAccessDenial({
    method: "POST",
    origin: "http://127.0.0.1:3000",
    fetchSite: "same-site",
    host: "127.0.0.1:3000",
  }),
  null,
);

assert.equal(
  getLocalAccessDenial({
    method: "GET",
    origin: undefined,
    fetchSite: undefined,
    host: "localhost:3000",
  }),
  null,
);

assert.equal(
  getLocalAccessDenial({
    method: "POST",
    origin: "https://example.com",
    fetchSite: "cross-site",
    host: "localhost:3000",
  }),
  "Requests are only allowed from the local app.",
);

assert.equal(
  getLocalAccessDenial({
    method: "DELETE",
    origin: undefined,
    fetchSite: "cross-site",
    host: "localhost:3000",
  }),
  "Cross-site changes are not allowed.",
);

assert.equal(
  getLocalAccessDenial({
    method: "GET",
    origin: undefined,
    fetchSite: undefined,
    host: "attacker.test:3000",
  }),
  "Requests require the local application Host header.",
);

console.log("localAccess tests passed");
