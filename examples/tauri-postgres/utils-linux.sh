#!/bin/bash

# This script runs the demo using this tauri example on Linux
# This script is necessary because there are many external tools that this demo depends on

# Get the electric sources for this example
get_electric() {
    git clone --depth 1 -b tauri-example-postgres git@github.com:electric-sql/electric.git
    cd electric/
}

# We need to have electric set up for local development, because we made a lot of changes to the sources
build_electric() {
    mkdir -p examples/tauri-postgres/db/data/
    #TODO: We need to get the issues.json with embeddings here.
    # ln -s $(PWD)/db/data/issues.json $(PWD)/electric/examples/tauri-postgres/db/data/issues.json
    cd clients/typescript && pnpm install && pnpm build
    cd ../../generator/ && pnpm install && pnpm build
    cd ../examples/tauri-postgres/
}

# Clone the sources
git_clone_third_parties() {
    # We are in root
    mkdir -p src-tauri/crates/ && cd src-tauri/crates/
    git clone https://github.com/pepperoni21/ollama-rs # Solves a bug where in Cargo.toml `git` would still not work as expected
    cd ollama-rs && git checkout f610472689ec113689ab06fb58304ec723c93111 && cd ..
    git clone https://github.com/faokunega/pg-embed # We need to modify this in order to have a different location for postgres
    cd pg-embed
    git apply ../../../pg-embed.patch
    cd ../../..
}


# Install ollama
# gives us src-tauri/ollama-darwin-aarch64-apple-darwin
install_ollama() {
    echo "Installing ollama"
    # wget https://github.com/jmorganca/ollama/releases/download/v0.1.20/ollama-darwin
    wget https://github.com/ollama/ollama/releases/download/v0.1.22/ollama-linux-amd64
    chmod +x ollama-linux-amd64

    # Tauri needs this specific name
    mv ollama-linux-amd64 src-tauri/ollama-x86_64-unknown-linux-gnu
}

# Install postgres
# gives us src-tauri/pgdir
install_postgres() {
    # We are in root
    echo "Installing postgres"
    # Create the directory where postgres will live as an external resource
    mkdir -p src-tauri/pgdir/
    cd src-tauri/pgdir/

    # wget https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-arm64v8/15.5.1/embedded-postgres-binaries-darwin-arm64v8-15.5.1.jar
    wget https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-linux-amd64/15.5.1/embedded-postgres-binaries-linux-amd64-15.5.1.jar
    # unzip embedded-postgres-binaries-darwin-arm64v8-15.5.1.jar
    unzip embedded-postgres-binaries-linux-amd64-15.5.1.jar

    # tar -xzvf postgres-darwin-arm_64.txz
    tar -xvf postgres-linux-x86_64.txz
    # We now have the postgres distro here
    # rm postgres-darwin-arm_64.txz
    rm postgres-linux-x86_64.txz
    # rm embedded-postgres-binaries-darwin-arm64v8-15.5.1.jar
    rm embedded-postgres-binaries-linux-amd64-15.5.1.jar
    rm -rf META-INF
    cd ../../ # root


    if [ -z "${PG_CONFIG}" ]; then
      echo "On linux, you need PG_CONFIG set up"
    else
      echo "PG_CONFIG is already set. Skipping configuration."
    fi

    git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git
    cd pgvector
    # Build pgvector with the downloaded postgres
    PG_CONFIG=../pgsql/bin/pg_config make
    # We don't need the downloaded postgres from this point
    rm -rf ../pgsql/

    # We need these files: TODO:
    mv sql/vector--0.5.1.sql ../src-tauri/pgdir/share/postgresql/extension/vector--0.5.1.sql
    mv vector.control ../src-tauri/pgdir/share/postgresql/extension/vector.control
    mv vector.so ../src-tauri/pgdir/lib/postgresql/vector.so
    cd ..
    # We don't need pgvector sources from this point
    rm -rf pgvector
}

# We also need to download the dynamic libraries for onnx
install_onnxruntime() {
    # We are in root
    wget https://github.com/microsoft/onnxruntime/releases/download/v1.16.3/onnxruntime-linux-x64-1.16.3.tgz
    tar -xzvf onnxruntime-linux-x64-1.16.3.tgz
    rm onnxruntime-linux-x64-1.16.3.tgz
    cp onnxruntime-linux-x64-1.16.3/lib/libonnxruntime.so.1.16.3 src-tauri/libonnxruntime.so
    rm -rf onnxruntime-linux-x64-1.16.3
}

# Build the Tauri app
build_the_app() {
    # We are in root
    pnpm install && pnpm run tauri:package
    pnpm tauri build # This also installs the app
}
