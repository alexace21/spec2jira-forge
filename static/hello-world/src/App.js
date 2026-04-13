import React, { useEffect, useState } from "react";
import { invoke } from "@forge/bridge";
import { view } from "@forge/bridge";

function App() {
  const [context, setContext] = useState(null);
  const [backendResult, setBackendResult] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    view.getContext().then(setContext);
  }, []);

  const testBackend = async () => {
    setLoading(true);
    setBackendResult(null);
    try {
      const result = await invoke("testBackend", {
        pageId: context?.extension?.content?.id,
        spaceKey: context?.extension?.space?.key,
      });
      setBackendResult(result);
    } catch (err) {
      setBackendResult({ success: false, message: err.message });
    }
    setLoading(false);
  };

  return (
    <div style={{ padding: "20px" }}>
      <h3>Spec2JIRA — Context Test</h3>

      {context ? (
        <div
          style={{
            background: "#f0f0f0",
            padding: "10px",
            marginBottom: "10px",
          }}
        >
          <strong>Page ID:</strong> {context?.extension?.content?.id}
          <br />
          <strong>Space Key:</strong> {context?.extension?.space?.key}
          <br />
          <strong>Content Type:</strong> {context?.extension?.content?.type}
        </div>
      ) : (
        <p>Loading context...</p>
      )}

      <button onClick={testBackend} disabled={loading || !context}>
        {loading ? "Testing..." : "Send Page Info to Backend"}
      </button>

      {backendResult && (
        <pre
          style={{
            marginTop: "10px",
            padding: "10px",
            background: backendResult.success ? "#e6ffe6" : "#ffe6e6",
          }}
        >
          {JSON.stringify(backendResult, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default App;
