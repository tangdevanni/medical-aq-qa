import type { PortalSelectorCandidate } from "./types";

export const loginSelectors: {
  username: PortalSelectorCandidate[];
  password: PortalSelectorCandidate[];
  submit: PortalSelectorCandidate[];
  authenticatedIndicators: PortalSelectorCandidate[];
} = {
  username: [
    {
      strategy: "label",
      value: /user(name)?|email/i,
      description: "login username field by label",
    },
    {
      strategy: "placeholder",
      value: /user(name)?|email/i,
      description: "login username field by placeholder",
    },
    {
      strategy: "css",
      selector: 'input[name="username"]',
      description: "login username field by name=username",
    },
    {
      strategy: "css",
      selector: 'input[name="email"]',
      description: "login username field by name=email",
    },
    {
      strategy: "css",
      selector: 'input[type="email"]',
      description: "login username field by type=email",
    },
  ],
  password: [
    {
      strategy: "label",
      value: /password/i,
      description: "login password field by label",
    },
    {
      strategy: "placeholder",
      value: /password/i,
      description: "login password field by placeholder",
    },
    {
      strategy: "css",
      selector: 'input[name="password"]',
      description: "login password field by name=password",
    },
    {
      strategy: "css",
      selector: 'input[type="password"]',
      description: "login password field by type=password",
    },
  ],
  submit: [
    {
      strategy: "role",
      role: "button",
      name: /log ?in|sign ?in|continue/i,
      description: "login submit button by accessible role",
    },
    {
      strategy: "text",
      value: /log ?in|sign ?in|continue/i,
      description: "login submit button by visible text",
    },
    {
      strategy: "css",
      selector: 'button[type="submit"]',
      description: "login submit button by type=submit",
    },
    {
      strategy: "css",
      selector: 'input[type="submit"]',
      description: "login submit input by type=submit",
    },
  ],
  authenticatedIndicators: [
    {
      strategy: "role",
      role: "textbox",
      name: /patient|search/i,
      description: "authenticated patient search input by role",
    },
    {
      strategy: "placeholder",
      value: /patient|search/i,
      description: "authenticated patient search input by placeholder",
    },
    {
      strategy: "role",
      role: "heading",
      name: /dashboard|patients|schedule/i,
      description: "authenticated dashboard heading by role",
    },
    {
      strategy: "css",
      selector: "main",
      description: "authenticated page main container",
    },
  ],
};
