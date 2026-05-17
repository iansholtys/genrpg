const path = require("node:path");
const express = require("express");
const { generators } = require("openid-client");
const { getOidcClient, getRedirectUri, upsertUser, userSummary } = require("../auth");

const OIDC_SCOPES = process.env.OIDC_SCOPES || "openid email profile";

const authRouter = express.Router();

function toSafeReturnPath(value) {
  if (!value || typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.startsWith("/auth/") || value === "/login" || value === "/logout") return "/";
  return value;
}

authRouter.get("/login", (req, res) => {
  if (req.session.user) {
    res.redirect("/");
    return;
  }

  res.sendFile(path.join(__dirname, "..", "..", "public", "login.html"));
});

authRouter.get("/auth/login", async (req, res, next) => {
  try {
    const client = await getOidcClient(req);
    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    req.session.oidc = {
      state,
      nonce,
      codeVerifier,
      returnTo: toSafeReturnPath(req.query.returnTo),
    };

    const authorizationUrl = client.authorizationUrl({
      scope: OIDC_SCOPES,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      redirect_uri: getRedirectUri(req),
    });

    res.redirect(authorizationUrl);
  } catch (error) {
    next(error);
  }
});

authRouter.get("/auth/callback", async (req, res, next) => {
  try {
    if (!req.session.oidc) {
      res.status(400).send("Login session is missing. Please start login again.");
      return;
    }

    const client = await getOidcClient(req);
    const params = client.callbackParams(req);
    const tokenSet = await client.callback(getRedirectUri(req), params, {
      state: req.session.oidc.state,
      nonce: req.session.oidc.nonce,
      code_verifier: req.session.oidc.codeVerifier,
    });
    const claims = tokenSet.claims();
    const user = await upsertUser({
      issuer: client.issuer.issuer,
      subject: claims.sub,
      email: claims.email,
      displayName: claims.name || claims.preferred_username || claims.email || claims.sub,
    });
    const returnTo = req.session.oidc.returnTo || "/";

    req.session.oidc = null;
    req.session.user = userSummary(user);
    res.redirect(returnTo);
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      next(error);
      return;
    }

    res.clearCookie("genrpg.sid");
    res.redirect("/login");
  });
});

module.exports = authRouter;
