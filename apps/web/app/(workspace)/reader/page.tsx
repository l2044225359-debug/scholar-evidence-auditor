import { Suspense } from "react";

import { PdfReader } from "@/components/pdf-reader";

export default function ReaderPage() {
  return (
    <Suspense fallback={null}>
      <PdfReader />
    </Suspense>
  );
}
