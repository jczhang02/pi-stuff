import { expect, test } from "bun:test";
import {
	extractOAuthConfig,
	parseAuthorizationRedirectInput,
	parseOAuthRedirectUri,
	supportsOAuth,
} from "../../packages/pi-stuff/src/mcp/runtime/mcp-auth-config.js";

test("validates OAuth configuration and authorization redirects at the trust boundary", () => {
	expect(
		extractOAuthConfig({
			url: "https://mcp.example/api",
			oauth: {
				clientId: "client",
				clientSecret: "!read-secret",
				authorizationParams: { audience: "https://mcp.example" },
				redirectUri: "http://127.0.0.1:3210/callback",
			},
		}),
	).toEqual({
		clientId: "client",
		clientSecret: "!read-secret",
		authorizationParams: { audience: "https://mcp.example" },
		redirectUri: "http://127.0.0.1:3210/callback",
	});
	expect(extractOAuthConfig({ url: "https://mcp.example", oauth: false })).toEqual({});
	for (const oauth of [
		{ clientId: 1 },
		{ clientSecret: 1 },
		{ scope: 1 },
		{ authorizationParams: [] },
		{ authorizationParams: { audience: 1 } },
		{ redirectUri: " " },
		{ clientName: " " },
		{ clientUri: " " },
	]) {
		// SAFETY: Deliberately bypass static config typing to exercise runtime validation of external input.
		expect(() => extractOAuthConfig({ url: "https://mcp.example", oauth: oauth as never })).toThrow();
	}
	expect(parseOAuthRedirectUri("http://127.0.0.1:3210/callback")).toEqual({
		port: 3210,
		callbackHost: "127.0.0.1",
		callbackPath: "/callback",
	});
	expect(parseOAuthRedirectUri("http://[::1]:3210/callback").callbackHost).toBe("::1");
	for (const redirectUri of [
		"https://localhost:3210/callback",
		"http://example.com:3210/callback",
		"http://localhost/callback",
		"http://user:pass@localhost:3210/callback",
		"http://localhost:3210/callback#fragment",
		"http://localhost:0/callback",
	]) {
		expect(() => parseOAuthRedirectUri(redirectUri)).toThrow();
	}
	expect(
		parseAuthorizationRedirectInput(
			"http://localhost:3210/callback?code=abc&state=expected&iss=https%3A%2F%2Fissuer.example",
			"expected",
		),
	).toEqual({ code: "abc", iss: "https://issuer.example" });
	expect(parseAuthorizationRedirectInput("abc", "expected")).toEqual({ code: "abc" });
	expect(() => parseAuthorizationRedirectInput("?code=abc", "expected")).toThrow("state missing");
	expect(() => parseAuthorizationRedirectInput("?code=abc&state=wrong", "expected")).toThrow("state mismatch");
	expect(() => parseAuthorizationRedirectInput("?error=access_denied&error_description=Nope")).toThrow(
		"access_denied: Nope",
	);
	expect(supportsOAuth({ url: "https://mcp.example" })).toBe(true);
	expect(supportsOAuth({ url: "https://mcp.example", headers: { Authorization: "Bearer token" } })).toBe(false);
	expect(supportsOAuth({ url: "https://mcp.example", auth: "oauth", headers: { Authorization: "token" } })).toBe(true);
});
