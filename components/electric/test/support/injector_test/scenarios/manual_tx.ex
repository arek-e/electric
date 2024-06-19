defmodule Electric.Postgres.Proxy.TestScenario.ManualTx do
  @moduledoc """
  Describes migrations being done within psql, so simple query protocol and no
  framework-assigned version, but with an explicit transaction
  """

  use Electric.Postgres.Proxy.TestScenario

  def tags do
    [scenario: :manual, protocol: :simple, framework: false, tx: true, version: false]
  end

  def description do
    "manual migration in tx: [simple, tx, no-version]"
  end

  def tx?, do: true

  def assert_non_electrified_migration(injector, _framework, query) do
    tag = random_tag()

    injector
    |> electric_begin(client: begin())
    |> client(query(query))
    |> server(complete_ready(tag, :tx))
    |> electric_commit(client: commit())
    |> idle!()
  end

  def assert_injector_passthrough(injector, framework, query) do
    assert_non_electrified_migration(injector, framework, query)
  end

  def assert_electrified_migration(injector, _framework, queries) do
    queries = List.wrap(queries)

    injector =
      injector
      |> electric_begin(client: begin())

    queries
    |> Enum.reduce(injector, &execute_tx_sql(&1, &2, :simple))
    |> client(commit(), server: capture_version_query())
    |> electric_commit(server: capture_version_complete())
    |> idle!()
  end

  def assert_injector_error(injector, query, error_details) do
    injector
    |> electric_begin(client: begin())
    |> client(query(query), client: [error(error_details), ready(:failed)])
    |> client(rollback())
    |> server(complete_ready("ROLLBACK", :idle))
    |> idle!()
  end

  def assert_valid_electric_command(injector, _framework, query, opts \\ []) do
    {:ok, command} = DDLX.parse(query)

    # may not be used but needs to be valid sql
    ddl = Keyword.get(opts, :ddl, "CREATE TABLE _not_used_ (id uuid PRIMARY KEY)")

    if Electric.DDLX.Command.modifies_permissions?(command) do
      injector
      |> electric_begin(client: begin())
      |> electric([client: query(query)], command, ddl,
        client: complete_ready(DDLX.Command.tag(command))
      )
      |> client(
        commit(),
        fn injector ->
          rules = permissions_modified!(injector)
          [server: save_permissions_rules_query(rules)]
        end
      )
      |> server(complete_ready(), server: capture_version_query())
      |> electric_commit(server: capture_version_complete())
      |> idle!()
    else
      injector
      |> electric_begin(client: begin())
      |> electric([client: query(query)], command, ddl,
        client: complete_ready(DDLX.Command.tag(command))
      )
      |> client(commit(), server: capture_version_query())
      |> electric_commit(server: capture_version_complete())
      |> idle!()
    end
  end

  def assert_electrify_server_error(injector, _framework, query, ddl, error_details) do
    # assert that the electrify command only generates a single query
    {:ok, command} = DDLX.parse(query)

    [electrify | _rest] =
      command
      |> proxy_sql(ddl)
      |> Enum.map(&query/1)

    injector
    |> electric_begin(client: begin())
    |> electric_preamble([client: query(query)], command)
    |> server(introspect_result(ddl), server: electrify)
    |> server([error(error_details), ready(:failed)])
    |> client(rollback())
    |> server(complete_ready("ROLLBACK", :idle))
    |> idle!()
  end
end
