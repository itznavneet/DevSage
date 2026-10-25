import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

os.environ.setdefault("OPENAI_API_KEY", "test-key")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import main  # noqa: E402


class AiServiceTests(unittest.TestCase):
    def setUp(self):
        self.qdrant = Mock()
        self.qdrant.scroll.return_value = ([], None)
        self.openai = Mock()
        main.qdrant = self.qdrant
        main.openai_client = self.openai

    def test_index_writes_repository_and_version_payload(self):
        self.openai.embeddings.create.return_value.data = [
            SimpleNamespace(index=0, embedding=[0.1, 0.2])
        ]

        result = main.index_chunks(main.IndexRequest(chunks=[
            main.CodeChunk(
                id="point-1",
                repository_id="repo-1",
                index_version="version-1",
                file_path="src/app.ts",
                start_line=1,
                end_line=2,
                content="export const answer = 42;",
            )
        ]))

        self.assertEqual(result["indexed_chunks"], 1)
        point = self.qdrant.upsert.call_args.kwargs["points"][0]
        self.assertEqual(point.payload["repository_id"], "repo-1")
        self.assertEqual(point.payload["index_version"], "version-1")

    def test_search_filters_by_repository_and_active_version(self):
        self.openai.embeddings.create.return_value.data = [
            SimpleNamespace(index=0, embedding=[0.1, 0.2])
        ]
        self.qdrant.query_points.return_value.points = []

        main.search_code(main.SearchRequest(
            repository_id="repo-1",
            index_version="version-2",
            question="Where is authentication?",
            limit=5,
        ))

        query_filter = self.qdrant.query_points.call_args.kwargs["query_filter"]
        values = [condition.match.value for condition in query_filter.must]
        self.assertIn("repo-1", values)
        self.assertIn("version-2", values)

    def test_ask_retrieves_twenty_candidates_and_removes_overlapping_chunks(self):
        self.openai.embeddings.create.return_value.data = [
            SimpleNamespace(index=0, embedding=[0.1, 0.2])
        ]
        self.qdrant.query_points.return_value.points = [
            SimpleNamespace(
                score=0.99,
                payload={
                    "file_path": "src/app.ts",
                    "start_line": 1,
                    "end_line": 80,
                    "content": "highest scoring chunk",
                },
            ),
            SimpleNamespace(
                score=0.98,
                payload={
                    "file_path": "src/app.ts",
                    "start_line": 71,
                    "end_line": 150,
                    "content": "overlapping chunk",
                },
            ),
            SimpleNamespace(
                score=0.97,
                payload={
                    "file_path": "src/routes.ts",
                    "start_line": 1,
                    "end_line": 40,
                    "content": "independent chunk",
                },
            ),
        ]
        self.openai.chat.completions.create.return_value.choices = [
            SimpleNamespace(message=SimpleNamespace(content="Grounded answer"))
        ]

        result = main.ask_repository(main.AskRequest(
            repository_id="repo-1",
            index_version="version-2",
            question="How does routing work?",
            limit=5,
        ))

        self.assertEqual(self.qdrant.query_points.call_args.kwargs["limit"], 20)
        query_filter = self.qdrant.query_points.call_args.kwargs["query_filter"]
        values = [condition.match.value for condition in query_filter.must]
        self.assertIn("repo-1", values)
        self.assertIn("version-2", values)
        self.assertEqual(len(result["sources"]), 2)
        self.assertEqual(
            [source["file_path"] for source in result["sources"]],
            ["src/app.ts", "src/routes.ts"],
        )
        prompt = self.openai.chat.completions.create.call_args.kwargs["messages"][1]["content"]
        self.assertIn("highest scoring chunk", prompt)
        self.assertNotIn("overlapping chunk", prompt)

    def test_rag_answer_uses_retrieved_context_and_returns_sources(self):
        self.openai.embeddings.create.return_value.data = [
            SimpleNamespace(index=0, embedding=[0.1, 0.2])
        ]
        self.qdrant.query_points.return_value.points = [SimpleNamespace(
            score=0.91,
            payload={
                "file_path": "src/auth.ts",
                "start_line": 10,
                "end_line": 20,
                "content": "export function login() {}",
            },
        )]
        self.openai.chat.completions.create.return_value.choices = [
            SimpleNamespace(message=SimpleNamespace(content="Use login() in src/auth.ts."))
        ]

        result = main.ask_repository(main.AskRequest(
            repository_id="repo-1",
            index_version="version-2",
            question="How does login work?",
            limit=5,
        ))

        self.assertIn("src/auth.ts", result["answer"])
        self.assertEqual(result["sources"][0]["file_path"], "src/auth.ts")
        prompt = self.openai.chat.completions.create.call_args.kwargs["messages"][1]["content"]
        self.assertIn("export function login() {}", prompt)

    def test_ask_combines_keyword_matches_with_semantic_candidates(self):
        self.openai.embeddings.create.return_value.data = [
            SimpleNamespace(index=0, embedding=[0.1, 0.2])
        ]
        self.qdrant.query_points.return_value.points = [SimpleNamespace(
            score=0.95,
            payload={
                "file_path": "src/dashboard.ts",
                "start_line": 1,
                "end_line": 30,
                "content": "render the dashboard overview",
            },
        )]
        self.qdrant.scroll.return_value = ([SimpleNamespace(
            id="jwt-point",
            payload={
                "file_path": "src/auth/jwt.ts",
                "start_line": 10,
                "end_line": 42,
                "content": "JWT token handling validates and signs tokens",
            },
        )], None)
        self.openai.chat.completions.create.return_value.choices = [
            SimpleNamespace(message=SimpleNamespace(content="JWT answer"))
        ]

        result = main.ask_repository(main.AskRequest(
            repository_id="repo-1",
            index_version="version-2",
            question="Where is the main logic for JWT token handling?",
            limit=5,
        ))

        self.assertEqual(result["sources"][0]["file_path"], "src/auth/jwt.ts")
        prompt = self.openai.chat.completions.create.call_args.kwargs["messages"][1]["content"]
        self.assertIn("JWT token handling validates", prompt)
        scroll_filter = self.qdrant.scroll.call_args.kwargs["scroll_filter"]
        values = [condition.match.value for condition in scroll_filter.must]
        self.assertIn("repo-1", values)
        self.assertIn("version-2", values)


if __name__ == "__main__":
    unittest.main()
