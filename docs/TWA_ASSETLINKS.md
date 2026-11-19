# TWA Digital Asset Links — fingerprint format (KID-2444)

`sunshine.kiddyapp.net/.well-known/assetlinks.json` is served by
`app/api/assetlinks/route.ts` from `lib/twa.ts`. The verifier needs one
`android_app` statement per package.

## The required fingerprint shape

`sha256_cert_fingerprints` entries MUST be **colon-separated uppercase hex**
of the raw SHA-256 certificate digest (32 octets), for example:

```json
"sha256_cert_fingerprints": [
  "8C:E1:28:14:12:5F:D3:5D:B0:F6:62:DC:56:D6:F3:D5:E5:A3:F7:14:BC:2C:26:56:48:3F:30:26:3D:50:01:BD"
]
```

**Do not use base64.** The Digital Asset Links API rejects a base64 digest as
`invalid_argument: malformed cert fingerprint` and marks the whole file
`ERROR_CODE_MALFORMED_CONTENT`. Android then cannot verify the app as the
owner of the host: Chrome opens an ordinary Custom Tab (URL bar), the TWA
notification delegation is not used, and the app's persistent Chrome profile /
web-push subscription are not the TWA ones.

## Derive the value from the release keystore (never hand-copy)

```sh
keytool -exportcert -keystore <jks> -alias kiddy-release -rfc \
  | openssl x509 -outform der \
  | openssl dgst -sha256 \
  | awk '{print toupper($2)}' \
  | sed 's/../&:/g; s/:$//'
```

Cross-check: the same digest as hex without colons must equal the
`apksigner verify --print-certs` output for the shipped APK.

## Verify a published host with Google

```sh
HEX='8C:E1:...:01:BD'   # colon-separated uppercase hex
curl -sG https://digitalassetlinks.googleapis.com/v1/assetlinks:check \
  --data-urlencode 'source.web.site=https://sunshine.kiddyapp.net' \
  --data-urlencode 'target.android_app.package_name=net.kiddyapp.sunshine' \
  --data-urlencode "target.android_app.certificate.sha256_fingerprint=$HEX" \
  --data-urlencode 'relation=delegate_permission/common.handle_all_urls'
```

A pass returns `linked: true` (no `errorCode`). A pass from
`statements:list` alone is not enough — it returns the published statements
without validating their descriptor shape on older API versions; use
`assetlinks:check` for the real answer.

Play-signed packages (`sunshine.kiddy.app`) publish the Play App Signing
fingerprint as a second entry; direct-install packages
(`net.kiddyapp.sunshine`, `com.kiddy.app`) use the release keystore
fingerprint only.
