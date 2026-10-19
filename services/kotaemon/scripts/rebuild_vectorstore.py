"""Rebuild the Kotaemon vectorstore from the current LanceDB chunks."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
from pathlib import Path

import chromadb
import lancedb

from kotaemon.base import Document, DocumentWithEmbedding
from kotaemon.embeddings import OpenAIEmbeddings
from kotaemon.storages import ChromaVectorStore


def _scalar_metadata(metadata: dict) -> dict:
    output = {}
    for key, value in metadata.items():
        if isinstance(value, (str, int, float, bool)) or value is None:
            output[key] = value
        else:
            output[key] = json.dumps(value, ensure_ascii=False)
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--data-dir",
        default="/home/lh/race/kotaemon/ktem_app_data/user_data",
    )
    parser.add_argument("--collection", default="index_1")
    parser.add_argument("--batch-size", type=int, default=8)
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    docstore_dir = data_dir / "docstore"
    vectorstore_dir = data_dir / "vectorstore"
    relation_table = f"{args.collection.replace('_', '__')}__index"

    app_db = sqlite3.connect(
        f"file:{data_dir / 'sql.db'}?mode=ro",
        uri=True,
    )
    try:
        valid_ids = {
            row[0]
            for row in app_db.execute(
                f"""
                SELECT target_id
                FROM {relation_table}
                WHERE relation_type = 'document'
                """
            )
        }
    finally:
        app_db.close()

    if not valid_ids:
        raise RuntimeError("No valid chunk relations found")

    docstore = lancedb.connect(str(docstore_dir))
    rows = docstore.open_table(args.collection).to_arrow().to_pylist()
    records = [row for row in rows if row["id"] in valid_ids]
    if not records:
        raise RuntimeError("No docstore chunks match the active relations")

    embedder = OpenAIEmbeddings(
        api_key=os.environ["OPENAI_API_KEY"],
        base_url=os.environ["OPENAI_API_BASE"],
        model=os.environ["OPENAI_EMBEDDINGS_MODEL"],
        timeout=90,
        max_retries=3,
    )

    client = chromadb.PersistentClient(path=str(vectorstore_dir))
    try:
        client.delete_collection(args.collection)
    except Exception:
        pass

    vectorstore = ChromaVectorStore(
        path=str(vectorstore_dir),
        collection_name=args.collection,
    )

    for start in range(0, len(records), args.batch_size):
        batch = records[start : start + args.batch_size]
        batch_docs = [
            Document(
                id_=row["id"],
                text=row["text"] or "<empty>",
                metadata=_scalar_metadata(
                    json.loads(row["attributes"] or "{}")
                ),
            )
            for row in batch
        ]
        embedded = embedder(batch_docs)
        nodes = [
            DocumentWithEmbedding(
                embedding=item.embedding,
                id_=source.id_,
                text=source.text,
                metadata=source.metadata,
            )
            for source, item in zip(batch_docs, embedded)
        ]
        vectorstore.add(
            embeddings=nodes,
            ids=[node.doc_id for node in nodes],
        )
        print(f"Embedded {min(start + len(batch), len(records))}/{len(records)}")

    print(
        "Rebuilt vectorstore:",
        len(records),
        "chunks in",
        args.collection,
    )


if __name__ == "__main__":
    main()
