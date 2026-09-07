"use client";

import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";

// Swagger UI touches window at import time, so it only ever renders on the
// client. Kept on a light surface regardless of the app theme: the bundled
// stylesheet assumes one, and a dark override would be a second stylesheet
// to maintain for an admin page opened a few times a month.
const SwaggerUI = dynamic(() => import("swagger-ui-react"), {
  ssr: false,
  loading: () => (
    <p className="p-6 text-sm text-muted-foreground">Loading the API reference…</p>
  ),
});

export function SwaggerView({ specUrl }: { specUrl: string }) {
  return (
    <div className="overflow-x-auto rounded-md border bg-white text-neutral-900 [color-scheme:light]">
      <SwaggerUI
        url={specUrl}
        docExpansion="list"
        defaultModelsExpandDepth={0}
        persistAuthorization
        tryItOutEnabled
        displayRequestDuration
      />
    </div>
  );
}
