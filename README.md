# meet.exe - Cinematic Video Broadcasting

A high-fidelity, minimalist, and secure video communication platform built for modern engineering teams. **meet.exe** (formerly RetroBeam) has been transformed from its legacy roots into a premium SaaS-style powerhouse, focusing on a zero-noise user experience and studio-quality media.

![Demo Mockup](https://images.unsplash.com/photo-1614332287897-cdc485fa562d?auto=format&fit=crop&q=80&w=1200)

## 🚀 Key Benefits

- **Minimalist UX**: A design that stays out of your way. No cluttered tables, just refined spacing and a clear visual hierarchy.
- **High-Fidelity Audio**: Custom WebRTC SDP patching to enforce **128kbps Opus** bitrate for crystal-clear conversations.
- **Secure by Default**: Mandatory JWT authentication for every room, ensuring your sessions are protected.
- **Developer-Centric**: Built with Next.js 14 and Tailwind CSS for rapid scaling and a premium feel.

## ✨ Features

- 📹 **Cinema-Grade Video**: Polished video tiles with glassmorphic labels and integrated Picture-in-Picture (PiP).
- 🖥️ **Ultra-Stable Screen Share**: Native high-bandwidth sharing for technical demos and code reviews.
- 🔐 **Broadcast Control**: Host controls for stream management, participants, and room settings.
- 🎨 **Modern SaaS Aesthetic**: A sleek, dark-mode-first UI inspired by industry leaders like Linear and Stripe.
- ⚡ **Real-time Mesh Networking**: Direct peer-to-peer communication using a customized WebRTC mesh architecture.

## 🛠️ Local Setup (Demo Version)

To get **meet.exe** running on your local machine:

### 1. Prerequisites
- **Node.js** (v18 or higher)
- **Git**

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/zennintoji29-create/retrobeamfrontend.git

# Enter the frontend directory
cd retrobeamfrontend

# Install dependencies
npm install
```

### 3. Environment Configuration
Create a `.env.local` file in the root of the frontend folder:
```env
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_SOCKET_URL=http://localhost:5000
```
*(Make sure the backend is running on port 5000)*

### 4. Running the App
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to see your local instance.

## ⚠️ Known Issues & Fixes (Demo Notes)

- **Browser Permissions**: Browsers often block camera/mic access on non-HTTPS origins (like localhost).
  - **Fix**: Use `localhost` instead of a local IP, or enable "Insecure origins treated as secure" in Chrome flags (`chrome://flags/#unsafely-treat-insecure-origin-as-secure`).
- **WebRTC Relay (STUN/TURN)**: In strict network environments (corporate firewalls), P2P connections might fail.
  - **Fix**: The production version uses dedicated TURN servers to relay traffic when direct P2P is blocked.
- **Authentication**: JWT tokens are currently stored in `localStorage` for the demo.
  - **Fix**: For production, cookie-based sessions with `HttpOnly` are recommended for enhanced security.

---

## 👨‍💻 Tech Stack
- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **State Management**: React Hooks + Local Storage
- **Communication**: WebRTC (Mesh), Socket.io v4
- **Animation**: Framer Motion
- **Icons**: Lucide React

---

*Transforming collaborative communication, one pixel at a time.*
