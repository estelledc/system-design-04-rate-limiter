local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_tokens = tonumber(ARGV[2])
local refill_interval_ms = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local idle_ttl_ms = tonumber(ARGV[5])

local capacity_units = capacity * refill_interval_ms
local cost_units = cost * refill_interval_ms
local now_parts = redis.call('TIME')
local now_ms = (tonumber(now_parts[1]) * 1000) + math.floor(tonumber(now_parts[2]) / 1000)

local stored = redis.call('HMGET', key, 'balance_units', 'last_refill_ms')
local balance_units = tonumber(stored[1])
local last_refill_ms = tonumber(stored[2])

if balance_units == nil or last_refill_ms == nil then
  balance_units = capacity_units
  last_refill_ms = now_ms
else
  if now_ms < last_refill_ms then
    now_ms = last_refill_ms
  end

  local max_useful_elapsed_ms = math.ceil(capacity_units / refill_tokens)
  local elapsed_ms = math.min(now_ms - last_refill_ms, max_useful_elapsed_ms)
  balance_units = math.min(capacity_units, balance_units + (elapsed_ms * refill_tokens))
  last_refill_ms = now_ms
end

local allowed = 0
if balance_units >= cost_units then
  balance_units = balance_units - cost_units
  allowed = 1
end

redis.call(
  'HSET',
  key,
  'balance_units',
  math.floor(balance_units),
  'last_refill_ms',
  math.floor(last_refill_ms)
)
redis.call('PEXPIRE', key, idle_ttl_ms)

local retry_after_ms = 0
if allowed == 0 then
  retry_after_ms = math.ceil((cost_units - balance_units) / refill_tokens)
end

local reset_after_ms = math.ceil((capacity_units - balance_units) / refill_tokens)
local remaining = math.floor(balance_units / refill_interval_ms)

return {allowed, remaining, retry_after_ms, reset_after_ms}
