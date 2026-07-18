// Builds a small Lua snippet that validates an access key against our own
// /api/keys/validate endpoint before letting the rest of the script run.
// This gets prepended to the user's source and obfuscated together with
// it (see routes/dashboard.js), so the check itself isn't visible either —
// only the compiled/encrypted loader ever leaves the server.
//
// End users are expected to set `_G.Key` (or `getgenv().Key` where
// available) to their key before running the loadstring, e.g.:
//   _G.Key = "LUVENN-8F2K-93QZ-4RXT"
//   loadstring(game:HttpGet("https://site/files/v3/loaders/<id>.lua"))()

function buildKeyCheckPreamble(siteUrl, publicId) {
  const validateUrl = `${siteUrl}/api/keys/validate?script=${publicId}&key=`;
  return [
    `local __gg = getgenv`,
    `local __k = (__gg and __gg().Key) or _G.Key`,
    `if type(__k) ~= "string" or __k == "" then`,
    `print("[luvenn] Set your key first, e.g: _G.Key = 'LUVENN-XXXX-XXXX-XXXX'")`,
    `return`,
    `end`,
    `local __ok = false`,
    `local __suc, __res = pcall(function() return game:HttpGet("${validateUrl}"..__k) end)`,
    `if __suc and __res == "valid" then __ok = true end`,
    `if not __ok then`,
    `print("[luvenn] Invalid or expired key.")`,
    `return`,
    `end`,
  ].join('\n');
}

module.exports = { buildKeyCheckPreamble };
