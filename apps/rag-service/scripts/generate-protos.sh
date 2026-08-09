#!/usr/bin/env bash
# Compiles the SHARED .proto into Python stubs.
#
# The proto lives in libs/grpc-proto, not here, and that is the point: the
# TypeScript client and this server are generated from one file. A hand-written
# Python mirror would drift, and the drift would not be a compile error on
# either side — it would be an UNIMPLEMENTED at runtime from a healthy server.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PROTO_ROOT="$ROOT/libs/grpc-proto/src/proto"
OUT="$HERE/../rag_service/generated"

mkdir -p "$OUT"

# The plugin is addressed by ABSOLUTE PATH rather than left to PATH lookup,
# for the same reason the interpreter above is: this script must work without
# the venv being activated.
"$HERE/../.venv/bin/python" -m grpc_tools.protoc \
  --plugin=protoc-gen-mypy_grpc="$HERE/../.venv/bin/protoc-gen-mypy_grpc" \
  -I "$PROTO_ROOT" \
  --python_out="$OUT" \
  --pyi_out="$OUT" \
  --grpc_python_out="$OUT" \
  --mypy_grpc_out="$OUT" \
  "$PROTO_ROOT/synapsedesk/rag/rag.proto" \
  "$PROTO_ROOT/synapsedesk/ingestion/ledger.proto" \
  "$PROTO_ROOT/synapsedesk/ops/ops.proto"

# `--mypy_grpc_out` (mypy-protobuf) emits `*_pb2_grpc.pyi`. Without it the
# servicer base class is UNANNOTATED: its methods end in `raise
# NotImplementedError`, so a checker infers `(request, context) -> Never` and
# then reports every real implementation as an inconsistent override. Seven
# methods, seven errors, none of them about anything wrong with the code.
# `--pyi_out` above covers the MESSAGES only; services need this second plugin.

# grpc_tools emits absolute-style imports (`from synapsedesk.rag import ...`)
# which only resolve if the generated tree is itself on sys.path. Rewriting
# them to be relative to the generated package keeps ONE import root for the
# service, rather than a second one that exists solely for generated code.
# BOTH `.py` and `.pyi`: mypy-protobuf emits the same absolute-style import in
# the stub, and a stub that cannot resolve its own imports reports the module
# as missing — turning a fix for one class of type error into another.
find "$OUT" \( -name '*_pb2_grpc.py' -o -name '*_pb2_grpc.pyi' \) -exec sed -i \
  's/^from synapsedesk\./from rag_service.generated.synapsedesk./' {} +

find "$OUT" -type d -exec touch {}/__init__.py \;
echo "Generated Python stubs into $OUT"
