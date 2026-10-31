# Remediation module setup

## Requirements

Node.js 20 or newer and an accessible MongoDB Atlas database. Groq is optional; deterministic payment-incident guidance is used when credentials are absent or the provider fails.

## Start

1. Copy `backend/.env.example` to `backend/.env` and set `MONGODB_URI` to your Atlas connection string. Optional: set `GROQ_API_KEY` and `GROQ_MODEL`.
2. In `backend`, run `npm install` and then `npm start`.
3. In `frontend`, run `npm install` and then `npm run dev`.
4. Open the Vite URL, normally `http://localhost:5173`. Use **Generate plan** to create the synthetic payment scenario in MongoDB.

The Vite development server proxies `/api` to port 4000. Set `FRONTEND_ORIGIN` when serving the UI from a different origin. Do not put provider credentials in frontend environment variables.

## Demo limitations

Runbooks are sample data and identify themselves as `SIMULATED_SAMPLE_RUNBOOK`. Reviews are stored in the remediation plan through `LOCAL_TEMPORARY`; they are not Shaanvi's workflow approval. No backend action executor exists. Marking a step complete records engineer progress only and makes no claim of production recovery. This starter repository also has no authentication; reviewer names are labels, not verified identities. Keep the API in a trusted local demo environment until authentication and authorization are integrated.
