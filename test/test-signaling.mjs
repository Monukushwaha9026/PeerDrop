import WebSocket from 'ws';
import assert from 'assert';

const WS_URL = 'ws://localhost:3000';

function waitMessage(ws, expectedType) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for message type: ${expectedType}`));
    }, 5000);

    const onMessage = (data) => {
      const msg = JSON.parse(data.toString());
      if (!expectedType || msg.type === expectedType) {
        clearTimeout(timeout);
        ws.off('message', onMessage);
        resolve(msg);
      }
    };
    ws.on('message', onMessage);
  });
}

async function runTests() {
  console.log('--- Starting PeerDrop Signaling & Room Tests ---');

  // Test 1: Connect Peer A and create room
  const wsA = new WebSocket(WS_URL);
  await new Promise(res => wsA.on('open', res));
  console.log('? Peer A connected to signaling');

  wsA.send(JSON.stringify({ type: 'create-room' }));
  const createdMsg = await waitMessage(wsA, 'room-created');
  const roomCode = createdMsg.code;
  assert(roomCode && roomCode.length >= 6, 'Room code should be at least 6 chars');
  console.log(`? Room created successfully with code: ${roomCode}`);

  // Test 2: Connect Peer B and join room
  const wsB = new WebSocket(WS_URL);
  await new Promise(res => wsB.on('open', res));
  console.log('? Peer B connected to signaling');

  const peerJoinedPromise = waitMessage(wsA, 'peer-joined');
  wsB.send(JSON.stringify({ type: 'join-room', payload: { code: roomCode } }));

  const joinedMsg = await waitMessage(wsB, 'room-joined');
  assert.strictEqual(joinedMsg.code, roomCode);
  console.log('? Peer B received room-joined confirmation');

  await peerJoinedPromise;
  console.log('? Peer A received peer-joined notification');

  // Test 3: SDP Offer / Answer exchange
  const answerPromise = waitMessage(wsA, 'answer');
  const offerPromise = waitMessage(wsB, 'offer');

  wsA.send(JSON.stringify({ type: 'offer', payload: { sdp: 'fake-sdp-offer-test' } }));
  const receivedOffer = await offerPromise;
  assert.strictEqual(receivedOffer.sdp, 'fake-sdp-offer-test');
  console.log('? Peer B received forwarded SDP offer');

  wsB.send(JSON.stringify({ type: 'answer', payload: { sdp: 'fake-sdp-answer-test' } }));
  const receivedAnswer = await answerPromise;
  assert.strictEqual(receivedAnswer.sdp, 'fake-sdp-answer-test');
  console.log('? Peer A received forwarded SDP answer');

  // Test 4: ICE Candidate exchange
  const icePromiseB = waitMessage(wsB, 'ice-candidate');
  wsA.send(JSON.stringify({ type: 'ice-candidate', payload: { candidate: { candidate: 'candidate:test' } } }));
  const receivedIceB = await icePromiseB;
  assert.strictEqual(receivedIceB.candidate.candidate, 'candidate:test');
  console.log('? Peer B received forwarded ICE candidate');

  // Test 5: Peer C attempts to join full room (Enforcing max 2 peers)
  const wsC = new WebSocket(WS_URL);
  await new Promise(res => wsC.on('open', res));
  wsC.send(JSON.stringify({ type: 'join-room', payload: { code: roomCode } }));
  const roomFullMsg = await waitMessage(wsC, 'error');
  assert.strictEqual(roomFullMsg.error, 'ROOM_FULL');
  console.log('? Peer C rejected with ROOM_FULL (strict 2-peer maximum verified)');
  wsC.close();

  // Test 6: Invalid room code
  const wsD = new WebSocket(WS_URL);
  await new Promise(res => wsD.on('open', res));
  wsD.send(JSON.stringify({ type: 'join-room', payload: { code: 'INVALID-99' } }));
  const notFoundMsg = await waitMessage(wsD, 'error');
  assert.strictEqual(notFoundMsg.error, 'ROOM_NOT_FOUND');
  console.log('? Peer D received ROOM_NOT_FOUND for invalid code');
  wsD.close();

  // Test 7: Peer temporary disconnect on raw socket drop (grace period)
  const peerReconnectingPromise = waitMessage(wsB, 'peer-reconnecting');
  wsA.close();
  await peerReconnectingPromise;
  console.log('✓ Peer B received peer-reconnecting notification when Peer A disconnected unexpectedly');

  // Test 8: Explicit leave notification
  const wsE = new WebSocket(WS_URL);
  await new Promise(res => wsE.on('open', res));
  wsE.send(JSON.stringify({ type: 'create-room' }));
  const roomEMsg = await waitMessage(wsE, 'room-created');
  
  const wsF = new WebSocket(WS_URL);
  await new Promise(res => wsF.on('open', res));
  const fJoinedPromise = waitMessage(wsE, 'peer-joined');
  wsF.send(JSON.stringify({ type: 'join-room', payload: { code: roomEMsg.code } }));
  await waitMessage(wsF, 'room-joined');
  await fJoinedPromise;

  const peerLeftPromise = waitMessage(wsE, 'peer-left');
  wsF.send(JSON.stringify({ type: 'leave-room' }));
  await peerLeftPromise;
  console.log('✓ Peer E received peer-left notification when Peer F left explicitly');
  wsE.close();
  wsF.close();
  wsB.close();

  console.log('\nAll 7 Signaling & Room Management Tests PASSED! ??');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
