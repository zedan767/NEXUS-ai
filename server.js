require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Firebase configuration
app.get("/api/config", function (_req, res) {
  res.json({
    firebase: {
      apiKey: process.env.FIREBASE_API_KEY || "",
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
      projectId: process.env.FIREBASE_PROJECT_ID || "",
      appId: process.env.FIREBASE_APP_ID || ""
    }
  });
});

// AI chat endpoint
app.post("/api/chat", async function (req, res) {
  const apiUrl = process.env.AI_API_URL;
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL || "gemini-2.5-flash";

  if (
    !apiUrl ||
    !apiKey ||
    apiKey === "put_your_rotated_api_key_here"
  ) {
    return res.status(503).json({
      error: "AI is not configured. Check your .env file."
    });
  }

  const messages = req.body && req.body.messages;

  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > 60
  ) {
    return res.status(400).json({
      error: "Please send a valid conversation."
    });
  }

  const safeMessages = messages.map(function (message) {
    return {
      role: ["system", "user", "assistant"].includes(
        message && message.role
      )
        ? message.role
        : "user",
      content: String(
        (message && message.content) || ""
      ).slice(0, 20000)
    };
  });

  try {
    const upstream = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey
      },
      body: JSON.stringify({
        model: model,
        messages: safeMessages,
        temperature: 0.7,
        stream: false
      }),
      signal: AbortSignal.timeout(90000)
    });

    const raw = await upstream.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch (_error) {
      data = { error: raw.slice(0, 1000) };
    }

    if (!upstream.ok) {
      console.error(
        "AI provider error:",
        upstream.status,
        raw.slice(0, 2000)
      );

      const providerMessage =
        (data.error && data.error.message) ||
        data.message ||
        (typeof data.error === "string" ? data.error : null) ||
        raw.slice(0, 1000) ||
        ("HTTP " + upstream.status);

      return res
        .status(upstream.status >= 500 ? 502 : upstream.status)
        .json({
          error:
            "AI provider error (" +
            upstream.status +
            "): " +
            providerMessage
        });
    }

    const answer =
      data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;

    if (typeof answer === "string" && answer.trim()) {
      return res.json({ answer: answer });
    }

    if (Array.isArray(answer)) {
      const combinedAnswer = answer
        .map(function (part) {
          return typeof part === "string"
            ? part
            : (part && part.text) || "";
        })
        .join("");

      if (combinedAnswer.trim()) {
        return res.json({ answer: combinedAnswer });
      }
    }

    console.error(
      "Unexpected AI response:",
      JSON.stringify(data).slice(0, 2000)
    );

    return res.status(502).json({
      error:
        "The provider responded, but no chat answer was found. Check the model and API format."
    });
  } catch (error) {
    console.error("AI request failed:", error);

    const isTimeout =
      error.name === "TimeoutError" ||
      error.name === "AbortError";

    return res.status(502).json({
      error: isTimeout
        ? "The AI request timed out. Please try again."
        : "Could not reach the AI provider. Check AI_API_URL and your internet connection."
    });
  }
});

// Serve the website
app.get("*", function (_req, res) {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

// Start server
app.listen(PORT, function () {
  console.log(
    "Nexus AI Pro running at http://localhost:" + PORT
  );
});