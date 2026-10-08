import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createFirestoreBackedStore } from '../server/cloud-store.mjs'
import { createSecretManagerTokenStore } from '../server/secret-manager-token-store.mjs'

function snapshot(value) {
  return {
    exists: value !== null,
    data: () => value,
  }
}

class FakeFirestore {
  value = null
  failuresRemaining = 0

  doc(path) {
    assert.equal(path, 'homework_state/saoirse')
    return {
      get: async () => snapshot(this.value),
    }
  }

  async runTransaction(callback) {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1
      throw new Error('Temporary Firestore outage')
    }
    let nextValue = this.value
    const transaction = {
      get: async () => snapshot(this.value),
      set: (_document, value) => { nextValue = value },
    }
    const result = await callback(transaction)
    this.value = nextValue
    return result
  }
}

test('Firestore snapshots restore the exact SQLite-backed state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saoirse-cloud-store-'))
  const firestore = new FakeFirestore()
  const first = await createFirestoreBackedStore(join(directory, 'first.sqlite'), {
    projectId: 'test-project',
    documentPath: 'homework_state/saoirse',
    firestore,
  })

  first.addAudit('cloud_test', { durable: true })
  await first.flushIfDirty()
  const uploadedRevision = firestore.value.revision
  assert.ok(Buffer.isBuffer(firestore.value.snapshot))
  assert.ok(uploadedRevision >= 2)
  await first.close()

  const second = await createFirestoreBackedStore(join(directory, 'second.sqlite'), {
    projectId: 'test-project',
    documentPath: 'homework_state/saoirse',
    firestore,
  })
  assert.deepEqual(second.listAudit(1)[0], {
    id: 1,
    eventType: 'cloud_test',
    details: { durable: true },
    createdAt: second.listAudit(1)[0].createdAt,
  })
  assert.ok(firestore.value.revision > uploadedRevision)
  await second.close()
})

test('a failed cloud save can retry all dirty state, including later changes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'saoirse-cloud-retry-'))
  const firestore = new FakeFirestore()
  const store = await createFirestoreBackedStore(join(directory, 'first.sqlite'), {
    projectId: 'test-project', firestore,
  })
  t.after(() => store.db.close())
  const confirmedRevision = firestore.value.revision

  store.addAudit('before_outage', { durable: true })
  firestore.failuresRemaining = 1
  await assert.rejects(store.flushIfDirty(), /Temporary Firestore outage/)
  assert.equal(firestore.value.revision, confirmedRevision)

  store.addAudit('after_outage', { durable: true })
  await Promise.all([store.flushIfDirty(), store.flushIfDirty()])
  assert.equal(firestore.value.revision, confirmedRevision + 1)

  const restored = await createFirestoreBackedStore(join(directory, 'restored.sqlite'), {
    projectId: 'test-project', firestore,
  })
  t.after(() => restored.db.close())
  assert.deepEqual(restored.listAudit(2).map((event) => event.eventType), ['after_outage', 'before_outage'])
})

test('queued cloud callers retain the failure and can recover on the next request', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'saoirse-cloud-queue-'))
  const firestore = new FakeFirestore()
  const store = await createFirestoreBackedStore(join(directory, 'state.sqlite'), {
    projectId: 'test-project', firestore,
  })
  t.after(() => store.db.close())
  store.addAudit('queued_save', {})
  firestore.failuresRemaining = 2
  const results = await Promise.allSettled([store.flushIfDirty(), store.flushIfDirty()])
  assert.deepEqual(results.map((result) => result.status), ['rejected', 'rejected'])
  await store.flushIfDirty()
  assert.equal(firestore.value.revision, 2)
})

test('retrying a cloud save never overwrites another server revision', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'saoirse-cloud-conflict-'))
  const firestore = new FakeFirestore()
  const store = await createFirestoreBackedStore(join(directory, 'state.sqlite'), {
    projectId: 'test-project', firestore,
  })
  t.after(() => store.db.close())
  const otherServerValue = { ...firestore.value, revision: firestore.value.revision + 1 }
  firestore.value = otherServerValue
  store.addAudit('unconfirmed_save', {})
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(store.flushIfDirty(), { code: 'cloud_snapshot_conflict', status: 409 })
    assert.equal(firestore.value, otherServerValue)
  }
})

test('Secret Manager token storage never exposes a disconnected older version', async () => {
  const versions = []
  const client = {
    async accessSecretVersion() {
      if (!versions.length) throw Object.assign(new Error('NOT_FOUND'), { code: 5 })
      return [{ payload: { data: Buffer.from(versions.at(-1)) } }]
    },
    async addSecretVersion({ payload }) {
      versions.push(Buffer.from(payload.data).toString('utf8'))
    },
  }
  const store = createSecretManagerTokenStore({
    projectId: 'test-project',
    secretId: 'calendar-token',
    client,
  })

  assert.equal(await store.getRefreshToken(), null)
  await store.setRefreshToken('refresh-token-value')
  assert.equal(await store.getRefreshToken(), 'refresh-token-value')
  await store.deleteRefreshToken()
  assert.equal(await store.getRefreshToken(), null)
  assert.equal(versions.includes('refresh-token-value'), true)
})
