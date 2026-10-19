import { translate, type Locale, type MessageKey } from "@/lib/i18n";
import type { KnowledgeCollection, SourceFile } from "@/lib/types";

type CollectionDefinition = {
  id: KnowledgeCollection["id"];
  nameKey: MessageKey;
  descriptionKey: MessageKey;
  matchers: RegExp[];
};

const collectionDefinitions: CollectionDefinition[] = [
  {
    id: "transformer",
    nameKey: "collections.transformer",
    descriptionKey: "collections.transformerDescription",
    matchers: [/transformer/i, /attention/i],
  },
  {
    id: "rag",
    nameKey: "collections.rag",
    descriptionKey: "collections.ragDescription",
    matchers: [
      /(^|[_-])rag([_-]|$)/i,
      /self[_-]?rag/i,
      /(^|[_-])dpr([_-]|$)/i,
      /retriev/i,
      /lost[_-]?in[_-]?the[_-]?middle/i,
    ],
  },
  {
    id: "agent",
    nameKey: "collections.agent",
    descriptionKey: "collections.agentDescription",
    matchers: [/react/i, /agent/i, /tool[_-]?use/i, /self[_-]?rag/i],
  },
];

export function buildKnowledgeCollections(
  files: SourceFile[],
  locale: Locale,
): KnowledgeCollection[] {
  return collectionDefinitions.map((definition) => {
    const matched = files.filter((file) =>
      definition.matchers.some((matcher) => matcher.test(file.name)),
    );
    return {
      id: definition.id,
      name: translate(locale, definition.nameKey),
      description: translate(locale, definition.descriptionKey),
      file_ids: matched.map((file) => file.id),
      document_count: matched.length,
    };
  });
}
