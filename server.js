const express = require('express');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static(path.join(__dirname)));

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const DATABASE_CHANNEL_ID = process.env.DATABASE_CHANNEL_ID;

// In-memory database (for simplicity)
const adminTimingData = {};
const adminMessageIds = {}; // To track individual messages for each user

// Discord Bot
const bot = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

bot.on('ready', async () => {
  console.log(`Bot logged in as ${bot.user.tag}`);

  // Fetch existing messages from the database channel
  const databaseChannel = await bot.channels.fetch(DATABASE_CHANNEL_ID);
  if (!databaseChannel) return console.error('Database channel not found.');

  const messages = await databaseChannel.messages.fetch();
  messages.forEach((message) => {
    const content = message.content.split('\n');
    const userId = content[0].split(': ')[1];
    const totalTime = parseInt(content[1].split(': ')[1]);

    adminTimingData[userId] = { totalTime, sessions: [] };
    adminMessageIds[userId] = message.id; // Store the message ID for updates
  });
});

bot.on('voiceStateUpdate', async (oldState, newState) => {
  const member = oldState.member || newState.member;

  // Check if the user has the admin role
  if (!member.roles.cache.has(ADMIN_ROLE_ID)) return;

  const adminId = member.id;
  const now = Date.now();

  if (newState.channel && !oldState.channel) {
    // Admin joined a voice channel
    adminTimingData[adminId] = adminTimingData[adminId] || { sessions: [] };
    adminTimingData[adminId].joinTime = now;
  } else if (!newState.channel && oldState.channel) {
    // Admin left a voice channel
    const joinTime = adminTimingData[adminId]?.joinTime;
    if (joinTime) {
      const timeSpent = now - joinTime;
      adminTimingData[adminId].totalTime = (adminTimingData[adminId].totalTime || 0) + timeSpent;
      adminTimingData[adminId].sessions.push({ timestamp: now, timeSpent });
      delete adminTimingData[adminId].joinTime;

      // Update the database channel message
      const databaseChannel = await bot.channels.fetch(DATABASE_CHANNEL_ID);
      if (!databaseChannel) return console.error('Database channel not found.');

      const user = await bot.users.fetch(adminId);
      const member = await bot.guilds.cache.first().members.fetch(adminId).catch(() => null);
      const nickname = member?.nickname || user.username;

      const messageContent = `
        **User ID:** ${adminId}
        **Total Time:** ${formatTime(adminTimingData[adminId].totalTime)}
        **Name:** ${nickname}
      `;

      if (adminMessageIds[adminId]) {
        // Edit the existing message
        const message = await databaseChannel.messages.fetch(adminMessageIds[adminId]);
        message.edit(messageContent);
      } else {
        // Create a new message
        const sentMessage = await databaseChannel.send(messageContent);
        adminMessageIds[adminId] = sentMessage.id;
      }
    }
  }
});

// Start the bot
bot.login(BOT_TOKEN);

// Serve the Website
app.get('/', async (req, res) => {
  const admins = await Promise.all(
    Object.keys(adminTimingData).map(async (adminId) => {
      const user = await bot.users.fetch(adminId).catch(() => null); // Handle errors fetching user
      const member = await bot.guilds.cache.first().members.fetch(adminId).catch(() => null); // Handle errors fetching member
      if (!user) return null; // Skip invalid users

      const now = Date.now();
      const todayStart = new Date().setHours(0, 0, 0, 0); // Midnight of the current day
      const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000; // 7 days ago
      const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000; // 30 days ago

      const todayTime = adminTimingData[adminId]?.sessions
        .filter((session) => session.timestamp >= todayStart)
        .reduce((sum, session) => sum + session.timeSpent, 0);

      const weeklyTime = adminTimingData[adminId]?.sessions
        .filter((session) => session.timestamp >= oneWeekAgo)
        .reduce((sum, session) => sum + session.timeSpent, 0);

      const monthlyTime = adminTimingData[adminId]?.sessions
        .filter((session) => session.timestamp >= oneMonthAgo)
        .reduce((sum, session) => sum + session.timeSpent, 0);

      return {
        adminId,
        username: user.username,
        nickname: member?.nickname || user.username, // Use nickname if available
        avatar: user.displayAvatarURL(),
        totalTime: adminTimingData[adminId]?.totalTime || 0,
        todayTime,
        weeklyTime,
        monthlyTime,
      };
    })
  ).then((admins) => admins.filter(Boolean)); // Filter out invalid users

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>A7 Admins</title>
      <style>
        body {
          margin: 0;
          font-family: Arial, sans-serif;
          background-color: #121212;
          color: #ffffff;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
        }
        .container {
          background-color: #1e1e1e;
          padding: 40px;
          border-radius: 10px;
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
          text-align: center;
          width: 600px;
        }
        h1 {
          color: #00bcd4;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }
        th, td {
          padding: 10px;
          border: 1px solid #333;
          text-align: center;
        }
        th {
          background-color: #00bcd4;
          color: #ffffff;
        }
        img {
          width: 50px;
          height: 50px;
          border-radius: 50%;
          cursor: pointer;
        }
        button {
          margin: 10px;
          padding: 10px 20px;
          background-color: #00bcd4;
          border: none;
          border-radius: 5px;
          color: #ffffff;
          font-size: 16px;
          cursor: pointer;
        }
        button:hover {
          background-color: #0097a7;
        }
        .modal {
          display: none;
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background-color: #1e1e1e;
          padding: 20px;
          border-radius: 10px;
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
          z-index: 1000;
          width: 400px;
        }
        .modal h2 {
          margin-bottom: 20px;
        }
        .overlay {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.5);
          z-index: 999;
        }
      </style>
      <!-- Flatpickr CSS -->
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css">
    </head>
    <body>
      <div class="container">
        <h1>A7 Admins</h1>
        <table id="adminTable">
          <thead>
            <tr>
              <th>Avatar</th>
              <th>Name</th>
              <th>Total Time</th>
            </tr>
          </thead>
          <tbody>
            ${admins
              .map(
                (admin) => `
                  <tr>
                    <td><img src="${admin.avatar}" alt="${admin.nickname}'s Avatar" onclick="showDetails('${admin.adminId}')"></td>
                    <td>${admin.nickname}</td>
                    <td>${formatTime(admin.totalTime)}</td>
                  </tr>
                `
              )
              .join('')}
          </tbody>
        </table>
      </div>

      <!-- Modal for User Details -->
      <div class="overlay" id="overlay"></div>
      <div class="modal" id="modal">
        <h2>User Details</h2>
        <p id="modalContent"></p>
        <button onclick="showToday()">Today</button>
        <button onclick="showWeekly()">Weekly</button>
        <button onclick="showMonthly()">Monthly</button>
        <button onclick="showAllTime()">All-Time</button>
        <button onclick="closeModal()">Close</button>
      </div>

      <!-- Flatpickr JS -->
      <script src="https://cdn.jsdelivr.net/npm/flatpickr"></script>
      <script>
        function formatTime(milliseconds) {
          const seconds = Math.floor(milliseconds / 1000);
          const minutes = Math.floor(seconds / 60);
          const hours = Math.floor(minutes / 60);
          return \`\${hours}h \${minutes % 60}m\`;
        }

        let selectedAdmin = null;

        function showDetails(adminId) {
          selectedAdmin = ${JSON.stringify(admins)}.find(a => a.adminId === adminId);
          const modalContent = document.getElementById('modalContent');
          modalContent.innerHTML = \`
            <strong>Name:</strong> \${selectedAdmin.nickname}<br>
            <strong>Total Time:</strong> \${formatTime(selectedAdmin.totalTime)}<br>
          \`;

          const overlay = document.getElementById('overlay');
          const modal = document.getElementById('modal');
          overlay.style.display = 'block';
          modal.style.display = 'block';
        }

        function closeModal() {
          const overlay = document.getElementById('overlay');
          const modal = document.getElementById('modal');
          overlay.style.display = 'none';
          modal.style.display = 'none';
        }

        function showToday() {
          const todayStart = new Date().setHours(0, 0, 0, 0); // Midnight of the current day
          const todayTime = selectedAdmin.sessions
            .filter(session => session.timestamp >= todayStart)
            .reduce((sum, session) => sum + session.timeSpent, 0);

          const modalContent = document.getElementById('modalContent');
          modalContent.innerHTML += \`<br><strong>Today:</strong> \${formatTime(todayTime)}\`;
        }

        function showWeekly() {
          flatpickr("#weeklyCalendar", {
            dateFormat: "Y-m-d",
            defaultDate: "today",
            onChange: function(selectedDates, dateStr) {
              const selectedDate = new Date(dateStr).getTime();
              const oneWeekAgo = selectedDate - 7 * 24 * 60 * 60 * 1000;
              const weeklyTime = selectedAdmin.sessions
                .filter(session => session.timestamp >= oneWeekAgo && session.timestamp <= selectedDate)
                .reduce((sum, session) => sum + session.timeSpent, 0);

              const modalContent = document.getElementById('modalContent');
              modalContent.innerHTML += \`<br><strong>Weekly (from \${dateStr}):</strong> \${formatTime(weeklyTime)}\`;
            }
          }).open();
        }

        function showMonthly() {
          flatpickr("#monthlyCalendar", {
            dateFormat: "Y-m-d",
            defaultDate: "today",
            onChange: function(selectedDates, dateStr) {
              const selectedDate = new Date(dateStr);
              const firstDayOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1).getTime();
              const lastDayOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getTime();

              const monthlyTime = selectedAdmin.sessions
                .filter(session => session.timestamp >= firstDayOfMonth && session.timestamp <= lastDayOfMonth)
                .reduce((sum, session) => sum + session.timeSpent, 0);

              const modalContent = document.getElementById('modalContent');
              modalContent.innerHTML += \`<br><strong>Monthly (\${selectedDate.toLocaleString('default', { month: 'long' })}):</strong> \${formatTime(monthlyTime)}\`;
            }
          }).open();
        }

        function showAllTime() {
          const modalContent = document.getElementById('modalContent');
          modalContent.innerHTML += \`<br><strong>All-Time:</strong> \${formatTime(selectedAdmin.totalTime)}\`;
        }
      </script>
    </body>
    </html>
  `);
});

// Helper function to format time
function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});