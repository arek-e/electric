import Config
import Dotenvy

############################
### Static configuration ###
############################

config :elixir, :time_zone_database, Tzdata.TimeZoneDatabase
config :ssl, protocol_version: [:"tlsv1.3", :"tlsv1.2"]

config :logger,
  handle_otp_reports: true,
  handle_sasl_reports: false

config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [
    # :pid is intentionally put as the first list item below. Logger prints metadata in the same order as it is configured
    # here, so having :pid sorted in the list alphabetically would make it get in the away of log output matching that we
    # do in many of our E2E tests.
    :pid,
    :client_id,
    :component,
    :connection,
    :instance_id,
    :origin,
    :pg_client,
    :pg_producer,
    :pg_slot,
    # :remote_ip is intentionally commented out below.
    #
    # IP addresses are user-identifiable information protected under GDPR. Our
    # customers might not like it when they use client IP addresses in the
    # logs of their on-premises installation of Electric.
    #
    # Although it appears the consensus is thta logging IP addresses is fine
    # (see https://law.stackexchange.com/a/28609), there are caveats.
    #
    # I think that adding IP addresses to logs should be made as part of the
    # same decision that determines the log retention policy. Since we're not
    # tying the logged IP addresses to users' personal information managed by
    # customer apps, we cannot clean them up as part of the "delete all user
    # data" procedure that app developers have in place to conform to GDPR
    # requirements. Therefore, logging IP addresses by default is better
    # avoided in production builds of Electric.
    #
    # We may introduce it as a configurable option for better DX at some point.
    # :remote_ip,
    :request_id,
    :sq_client,
    :user_id,
    :proxy_session_id
  ]

config :electric, Electric.Postgres.CachedWal.Api, adapter: Electric.Postgres.CachedWal.EtsBacked

config :electric, Electric.Replication.Postgres,
  pg_client: Electric.Replication.Postgres.Client,
  producer: Electric.Replication.Postgres.LogicalReplicationProducer

config :electric, Electric.Postgres.Proxy.Handler.Tracing, colour: true

config :electric,
  # The default acceptable clock drift is set to 2 seconds based on the following mental model:
  #
  #   - assume there's a server that generates JWTs and its internal clock has +1 second drift from UTC
  #
  #   - assume that Electric runs on a server that has -1 second clock drift from UTC
  #
  #   - when a new auth token is generated and is immediately sent to Electric, the latter will
  #     see its `iat` date being 2 seconds in the future (minus network and processing latencies)
  #
  #   - JWT timestamp validation has 1-second resolution. So we pick 1 second as the upper bound for clock drift on
  #     servers that regularly synchronize their clocks via NTP
  #
  max_clock_drift_seconds: 2,
  telemetry_url: "https://checkpoint.electric-sql.com"

##########################
### User configuration ###
##########################

default_log_level = "info"
default_auth_mode = "secure"
default_http_server_port = 5133
default_pg_server_port = 5433
default_pg_proxy_port = 65432
default_listen_on_ipv6 = true
default_database_require_ssl = true
default_database_use_ipv6 = false
default_write_to_pg_mode = "logical_replication"
default_proxy_tracing_enable = false
default_resumable_wal_window = 2 * 1024 * 1024 * 1024
default_txn_cache_size = 256 * 1024 * 1024
default_metric_period = 2_000

if config_env() in [:dev, :test] do
  source!([".env.#{config_env()}", ".env.#{config_env()}.local", System.get_env()])
end

###
# Required options
###

auth_mode = env!("AUTH_MODE", :string, default_auth_mode)

auth_opts = [
  alg: {"AUTH_JWT_ALG", env!("AUTH_JWT_ALG", :string, nil)},
  key: {"AUTH_JWT_KEY", env!("AUTH_JWT_KEY", :string, nil)},
  key_is_base64_encoded:
    {"AUTH_JWT_KEY_IS_BASE64_ENCODED", env!("AUTH_JWT_KEY_IS_BASE64_ENCODED", :boolean, nil)},
  namespace: {"AUTH_JWT_NAMESPACE", env!("AUTH_JWT_NAMESPACE", :string, nil)},
  iss: {"AUTH_JWT_ISS", env!("AUTH_JWT_ISS", :string, nil)},
  aud: {"AUTH_JWT_AUD", env!("AUTH_JWT_AUD", :string, nil)}
]

{auth_provider, auth_errors} = Electric.Config.validate_auth_config(auth_mode, auth_opts)

database_url_config =
  env!("DATABASE_URL", :string, nil)
  |> Electric.Config.parse_database_url(config_env())

write_to_pg_mode_config =
  env!("ELECTRIC_WRITE_TO_PG_MODE", :string, default_write_to_pg_mode)
  |> Electric.Config.parse_write_to_pg_mode()

logical_publisher_host_config =
  env!("LOGICAL_PUBLISHER_HOST", :string, nil)
  |> Electric.Config.parse_logical_publisher_host(write_to_pg_mode_config)

log_level_config =
  env!("LOG_LEVEL", :string, default_log_level)
  |> Electric.Config.parse_log_level()

pg_proxy_password_config =
  env!("PG_PROXY_PASSWORD", :string, nil)
  |> Electric.Config.parse_pg_proxy_password()

{use_http_tunnel?, pg_proxy_port_config} =
  env!("PG_PROXY_PORT", :string, nil)
  |> Electric.Config.parse_pg_proxy_port(default_pg_proxy_port)

metric_period = env!("METRICS_MEASUREMENT_PERIOD", :integer, default_metric_period)
statsd_host = env!("STATSD_HOST", :string?, nil)

potential_errors =
  auth_errors ++
    [
      {"DATABASE_URL", database_url_config},
      {"ELECTRIC_WRITE_TO_PG_MODE", write_to_pg_mode_config},
      {"LOGICAL_PUBLISHER_HOST", logical_publisher_host_config},
      {"LOG_LEVEL", log_level_config},
      {"PG_PROXY_PASSWORD", pg_proxy_password_config},
      {"PG_PROXY_PORT", pg_proxy_port_config}
    ]

if error = Electric.Config.format_required_config_error(potential_errors) do
  Electric.Errors.print_fatal_error(error)
end

###

wal_window_config =
  [
    {"ELECTRIC_RESUMABLE_WAL_WINDOW", default_resumable_wal_window},
    {"ELECTRIC_TXN_CACHE_SIZE", default_txn_cache_size}
  ]
  |> Enum.map(fn {var, default} ->
    {var, env!(var, :string, nil) |> Electric.Config.parse_human_readable_size(default)}
  end)

if error = Electric.Config.format_invalid_config_error(wal_window_config) do
  Electric.Errors.print_fatal_error(error)
end

{:ok, log_level} = log_level_config
config :logger, level: log_level
config :telemetry_poller, :default, period: metric_period

config :electric, Electric.Satellite.Auth, provider: auth_provider

pg_server_port = env!("LOGICAL_PUBLISHER_PORT", :integer, default_pg_server_port)
listen_on_ipv6? = env!("ELECTRIC_USE_IPV6", :boolean, default_listen_on_ipv6)
{:ok, write_to_pg_mode} = write_to_pg_mode_config

config :electric,
  # Used in telemetry, and to identify the server to the client
  instance_id: env!("ELECTRIC_INSTANCE_ID", :string, Electric.Utils.uuid4()),
  http_port: env!("HTTP_PORT", :integer, default_http_server_port),
  pg_server_port: pg_server_port,
  listen_on_ipv6?: listen_on_ipv6?,
  telemetry_statsd_host: statsd_host,
  write_to_pg_mode: write_to_pg_mode

# disable all ddlx commands apart from `ENABLE`
# override these using the `ELECTRIC_FEATURES` environment variable, e.g.
# to add a flag enabling `ELECTRIC GRANT` use:
#
#     export ELECTRIC_FEATURES="proxy_ddlx_grant=true:${ELECTRIC_FEATURES:-}"
#
# or if you want to just set flags, ignoring any previous env settings
#
#     export ELECTRIC_FEATURES="proxy_ddlx_grant=true:proxy_ddlx_assign=true"
#
config :electric, Electric.Features,
  proxy_ddlx_grant: false,
  proxy_ddlx_revoke: false,
  proxy_ddlx_assign: false,
  proxy_ddlx_unassign: false

{:ok, conn_config} = database_url_config

connector_config =
  if conn_config do
    require_ssl_config = env!("DATABASE_REQUIRE_SSL", :boolean, nil)

    # In Electric, we only support two ways of using SSL for database connections:
    #
    #   1. It is either required, in which case a failure to establish a secure connection to the
    #      database will be treated as a fatal error.
    #
    #   2. Or it is not required, in which case Electric will still try connecting with SSL first
    #      and will only fall back to using unencrypted connection if that fails.
    #
    # When DATABASE_REQUIRE_SSL is set by the user, the sslmode query parameter in DATABASE_URL is ignored.
    require_ssl? =
      case {require_ssl_config, conn_config[:sslmode]} do
        {nil, nil} ->
          # neither DATABASE_REQUIRE_SSL nor ?sslmode=... are present, use the default setting
          default_database_require_ssl

        {true, _} ->
          # DATABASE_REQUIRE_SSL=true: require database connections to use SSL
          true

        {nil, :require} ->
          # ?sslmode=require and DATABASE_REQUIRE_SSL is not set: require database connections to use SSL
          true

        _ ->
          # any other value of ?sslmode=... or DATABASE_REQUIRE_SSL means SSL is not required
          false
      end

    # When require_ssl?=true, epgsql will try to connect using SSL and fail if the server does not accept encrypted
    # connections.
    #
    # When require_ssl?=false, epgsql will try to connect using SSL first, then fall back to an unencrypted connection
    # if that fails.
    use_ssl? =
      if require_ssl? do
        :required
      else
        true
      end

    use_ipv6? = env!("DATABASE_USE_IPV6", :boolean, default_database_use_ipv6)

    conn_config =
      conn_config
      |> Keyword.put(:ssl, use_ssl?)
      |> Keyword.put(:ipv6, use_ipv6?)
      |> Keyword.put(:replication, "database")
      |> Keyword.update(:timeout, 5_000, &String.to_integer/1)

    {:ok, pg_server_host} = logical_publisher_host_config

    {:ok, proxy_port} = pg_proxy_port_config
    {:ok, proxy_password} = pg_proxy_password_config

    proxy_listener_opts =
      if listen_on_ipv6? do
        [transport_options: [:inet6]]
      else
        []
      end

    [
      postgres_1: [
        producer: Electric.Replication.Postgres.LogicalReplicationProducer,
        connection: conn_config,
        replication: [
          electric_connection: [
            host: pg_server_host,
            port: pg_server_port,
            dbname: "electric",
            connect_timeout: conn_config[:timeout]
          ]
        ],
        proxy: [
          # listen opts are ThousandIsland.options()
          # https://hexdocs.pm/thousand_island/ThousandIsland.html#t:options/0
          listen: [port: proxy_port] ++ proxy_listener_opts,
          use_http_tunnel?: use_http_tunnel?,
          password: proxy_password,
          log_level: log_level
        ],
        wal_window:
          Enum.map(wal_window_config, fn
            {"ELECTRIC_RESUMABLE_WAL_WINDOW", {:ok, size}} -> {:resumable_size, size}
            {"ELECTRIC_TXN_CACHE_SIZE", {:ok, size}} -> {:in_memory_size, size}
          end)
      ]
    ]
  end

config :electric, Electric.Replication.Connectors, List.wrap(connector_config)

enable_proxy_tracing? = env!("PROXY_TRACING_ENABLE", :boolean, default_proxy_tracing_enable)
config :electric, Electric.Postgres.Proxy.Handler.Tracing, enable: enable_proxy_tracing?

# This is intentionally an atom and not a boolean - we expect to add `:extended` state
telemetry =
  case env!("ELECTRIC_TELEMETRY", :string, nil) do
    nil -> :enabled
    x when x in ~w[0 f false disable disabled n no off] -> :disabled
    x when x in ~w[1 t true enable enabled y yes on] -> :enabled
    x -> raise "Invalid value for `ELECTRIC_TELEMETRY`: #{x}"
  end

config :electric, :telemetry, telemetry

if config_env() in [:dev, :test] do
  path = Path.expand("runtime.#{config_env()}.exs", __DIR__)

  if File.exists?(path) do
    Code.require_file(path)
  end
end
