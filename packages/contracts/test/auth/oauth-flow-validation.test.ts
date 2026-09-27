import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  oauthFlowInfoSchema,
  oauthInteractionSchema,
  respondOAuthFlowRequestSchema,
} from "../../src/domains/auth/auth.js";

const flowIdentity = {
  flowId: "authflow_example",
  provider: "example",
  providerName: "Example",
  createdAt: "2026-09-27T10:00:00.000Z",
  updatedAt: "2026-09-27T10:00:01.000Z",
};

describe("OAuth interactions", () => {
  it("accepts every interaction variant", () => {
    const interactions = [
      { type: "starting" },
      {
        type: "choice",
        interactionId: "prompt_1",
        message: "Choose a login method",
        options: [
          {
            id: "browser",
            label: "Browser",
            description: "Sign in with a browser",
          },
        ],
      },
      {
        type: "browser",
        authorizationUrl: "https://auth.example.com/authorize",
        instructions: "Complete sign-in in your browser.",
        manualEntry: {
          interactionId: "redirect_1",
          label: "Redirect URL",
          placeholder: "http://localhost:8484/callback?code=...&state=...",
          acceptedInput: "redirect_url",
        },
      },
      {
        type: "device_code",
        verificationUrl: "https://example.com/device",
        userCode: "ABCD-EFGH",
        expiresAt: "2026-09-27T10:10:00.000Z",
        intervalSeconds: 5,
      },
      {
        type: "text_input",
        interactionId: "prompt_2",
        message: "Paste the authorization code",
        placeholder: "Authorization code",
        inputKind: "authorization",
        allowEmpty: false,
      },
      {
        type: "progress",
        message: "Waiting for authorization",
        links: [{ url: "https://example.com/help", label: "Help" }],
      },
    ];

    for (const interaction of interactions) {
      assert.equal(oauthInteractionSchema.safeParse(interaction).success, true);
    }
  });

  it("rejects fields from another interaction variant", () => {
    assert.equal(
      oauthInteractionSchema.safeParse({
        type: "starting",
        message: "Not valid for starting",
      }).success,
      false,
    );
    assert.equal(
      oauthInteractionSchema.safeParse({
        type: "device_code",
        verificationUrl: "https://example.com/device",
        userCode: "ABCD",
        interactionId: "prompt_1",
      }).success,
      false,
    );
    assert.equal(
      oauthInteractionSchema.safeParse({
        type: "browser",
        authorizationUrl: "https://example.com/authorize",
        instructions: "Sign in",
        manualEntry: {
          interactionId: "redirect_1",
          label: "Redirect URL",
          placeholder: "Paste URL",
          acceptedInput: "text",
        },
      }).success,
      false,
    );
  });
});

describe("OAuth flows", () => {
  it("accepts active and terminal flow variants", () => {
    const flows = [
      {
        ...flowIdentity,
        state: "active",
        interaction: { type: "starting" },
      },
      {
        ...flowIdentity,
        state: "succeeded",
        successMessage: "Connected successfully.",
      },
      {
        ...flowIdentity,
        state: "failed",
        failure: {
          message: "Authorization failed.",
          detail: "The provider rejected the request.",
        },
      },
      { ...flowIdentity, state: "cancelled" },
    ];

    for (const flow of flows) {
      assert.equal(oauthFlowInfoSchema.safeParse(flow).success, true);
    }
  });

  it("rejects interactions on terminal flows and results on active flows", () => {
    assert.equal(
      oauthFlowInfoSchema.safeParse({
        ...flowIdentity,
        state: "succeeded",
        successMessage: "Connected.",
        interaction: { type: "starting" },
      }).success,
      false,
    );
    assert.equal(
      oauthFlowInfoSchema.safeParse({
        ...flowIdentity,
        state: "failed",
        failure: { message: "Failed." },
        interaction: { type: "progress", message: "Still working" },
      }).success,
      false,
    );
    assert.equal(
      oauthFlowInfoSchema.safeParse({
        ...flowIdentity,
        state: "active",
        interaction: { type: "starting" },
        successMessage: "Connected.",
      }).success,
      false,
    );
    assert.equal(
      oauthFlowInfoSchema.safeParse({
        ...flowIdentity,
        state: "cancelled",
        failure: { message: "Not a cancellation field" },
      }).success,
      false,
    );
  });
});

describe("OAuth flow responses", () => {
  it("accepts each response variant", () => {
    const responses = [
      {
        type: "select",
        interactionId: "prompt_1",
        selectedId: "browser",
      },
      { type: "text", interactionId: "prompt_2", value: "answer" },
      {
        type: "manual_redirect",
        interactionId: "redirect_1",
        value: "http://localhost:8484/callback?code=abc&state=xyz",
      },
    ];

    for (const response of responses) {
      assert.equal(
        respondOAuthFlowRequestSchema.safeParse(response).success,
        true,
      );
    }
  });

  it("rejects missing and cross-variant response fields", () => {
    const invalidResponses = [
      { type: "select", interactionId: "prompt_1" },
      {
        type: "select",
        interactionId: "prompt_1",
        selectedId: "browser",
        value: "unexpected",
      },
      {
        type: "text",
        interactionId: "prompt_2",
        selectedId: "browser",
      },
      {
        type: "manual_redirect",
        interactionId: "redirect_1",
        value: "http://localhost/callback",
        selectedId: "unexpected",
      },
      { type: "unknown", interactionId: "prompt_1", value: "answer" },
    ];

    for (const response of invalidResponses) {
      assert.equal(
        respondOAuthFlowRequestSchema.safeParse(response).success,
        false,
      );
    }
  });
});
