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

  doc(path) {
    assert.equal(path, 'homework_state/saoirse')
    return {
      get: async () => snapshot(this.value),
    }
  }

  async runTransaction(callback) {
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
