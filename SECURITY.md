# Security policy

## Supported version

Only the latest commit on `main` is maintained. This repository is a learning
implementation, not a hosted service or a drop-in security boundary.

## Reporting

Please use GitHub's private vulnerability reporting for this repository. Do
not include production credentials, real API keys, Redis URLs, or personal
data in a report or reproduction.

## Deployment warning

`x-api-key` is used only as a stable quota partition input. This demo does not
authenticate or authorize that key. Deploy the limiter behind a trusted
authentication gateway, use a secret manager for `PARTITION_HMAC_SECRET`, and
restrict `/metrics` and health endpoints at the network layer.
