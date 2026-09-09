import {
  createBackupEnvelope,
  parseAthleteProfile,
  parseBackupEnvelope,
  parseOnboardingDraft,
  parseWeekImportBundle,
  parseWeekPlan,
  parseWorkoutLog,
  validateWorkoutLogsForWeekPlan,
  type AthleteProfile,
  type BackupEnvelope,
  type OnboardingDraft,
  type WeekImportBundle,
  type WeekPlan,
  type WorkoutLog,
} from '../domain/contracts.ts'

export const HYBRID_COACH_DB_NAME = 'hybrid-coach-mvp'
export const HYBRID_COACH_DB_VERSION = 1

const STORE_META = 'meta'
const STORE_ATHLETES = 'athleteProfiles'
const STORE_WEEKS = 'weekPlans'
const STORE_LOGS = 'workoutLogs'
const STORE_DRAFTS = 'onboardingDrafts'

const RESETTABLE_STORES = [STORE_ATHLETES, STORE_WEEKS, STORE_LOGS, STORE_DRAFTS] as const

interface MetaRecord {
  key: 'schema'
  databaseVersion: number
  domainVersion: number
  updatedAt: string
}

export interface WorkoutLogListQuery {
  athleteId?: string
  weekPlanId?: string
  workoutId?: string
}

export interface WeekImportOptions {
  readonly deleteWorkoutIds?: readonly string[]
  // Checked inside the write transaction so approval cannot overwrite a newer profile.
  readonly expectedAthleteProfile?: AthleteProfile
}

function openDatabase(name = HYBRID_COACH_DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this environment.'))
      return
    }
    const request = indexedDB.open(name, HYBRID_COACH_DB_VERSION)
    let blocked = false
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_META)) database.createObjectStore(STORE_META, { keyPath: 'key' })
      if (!database.objectStoreNames.contains(STORE_ATHLETES)) database.createObjectStore(STORE_ATHLETES, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(STORE_WEEKS)) database.createObjectStore(STORE_WEEKS, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(STORE_LOGS)) database.createObjectStore(STORE_LOGS, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(STORE_DRAFTS)) database.createObjectStore(STORE_DRAFTS, { keyPath: 'id' })
      const meta: MetaRecord = {
        key: 'schema',
        databaseVersion: HYBRID_COACH_DB_VERSION,
        domainVersion: 1,
        updatedAt: new Date().toISOString(),
      }
      request.transaction?.objectStore(STORE_META).put(meta)
    }
    request.onblocked = () => {
      blocked = true
      reject(new Error('Close other planner tabs before updating local training storage.'))
    }
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB.'))
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      if (blocked) {
        database.close()
        return
      }
      resolve(database)
    }
  })
}

function transactionFailure(transaction: IDBTransaction, fallback: string): Error {
  return transaction.error ?? new Error(fallback)
}

function sortDescendingByDate<T extends { id: string }>(items: readonly T[], getDate: (item: T) => string): T[] {
  return [...items].sort((left, right) => getDate(right).localeCompare(getDate(left)) || left.id.localeCompare(right.id))
}

function combineLogs(existing: readonly WorkoutLog[], incoming: readonly WorkoutLog[], weekPlanId: string): WorkoutLog[] {
  const merged = new Map<string, WorkoutLog>()
  for (const log of existing) {
    if (log.weekPlanId === weekPlanId) merged.set(log.id, log)
  }
  for (const log of incoming) merged.set(log.id, log)
  return [...merged.values()]
}

function parseLogs(values: unknown[]): WorkoutLog[] {
  return values.map(value => parseWorkoutLog(value))
}

function assertLogIdentity(existing: WorkoutLog | undefined, incoming: WorkoutLog): void {
  if (existing && (
    existing.athleteId !== incoming.athleteId
    || existing.weekPlanId !== incoming.weekPlanId
    || existing.workoutId !== incoming.workoutId
  )) {
    throw new Error(`Workout log ${incoming.id} already belongs to a different athlete, week, or workout.`)
  }
}

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback)
}

export interface HybridCoachRepository {
  saveAthleteProfile(profile: AthleteProfile): Promise<AthleteProfile>
  getAthleteProfile(id: string): Promise<AthleteProfile | undefined>
  listAthleteProfiles(): Promise<AthleteProfile[]>
  saveWeekPlan(weekPlan: WeekPlan): Promise<WeekPlan>
  getWeekPlan(id: string): Promise<WeekPlan | undefined>
  listWeekPlans(athleteId?: string): Promise<WeekPlan[]>
  getLatestWeekPlan(athleteId: string): Promise<WeekPlan | undefined>
  deleteWeekPlan(id: string): Promise<void>
  saveWorkoutLog(workoutLog: WorkoutLog): Promise<WorkoutLog>
  listWorkoutLogs(query?: WorkoutLogListQuery): Promise<WorkoutLog[]>
  deleteWorkoutLog(id: string): Promise<void>
  saveOnboardingDraft(draft: OnboardingDraft): Promise<OnboardingDraft>
  getOnboardingDraft(id: string): Promise<OnboardingDraft | undefined>
  listOnboardingDrafts(athleteId?: string): Promise<OnboardingDraft[]>
  deleteOnboardingDraft(id: string): Promise<void>
  importWeek(bundle: WeekImportBundle, options?: WeekImportOptions): Promise<WeekImportBundle>
  exportBackup(): Promise<BackupEnvelope>
  restoreBackup(backup: BackupEnvelope): Promise<BackupEnvelope>
  reset(): Promise<void>
}

export function createHybridCoachRepository(name = HYBRID_COACH_DB_NAME): HybridCoachRepository {
  return {
    async saveAthleteProfile(profile) {
      const validated = parseAthleteProfile(profile)
      const database = await openDatabase(name)
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_ATHLETES], 'readwrite')
        transaction.objectStore(STORE_ATHLETES).put(validated)
        transaction.oncomplete = () => {
          database.close()
          resolve(validated)
        }
        transaction.onabort = () => {
          database.close()
          reject(transactionFailure(transaction, 'Could not save the athlete profile.'))
        }
      })
    },

    async getAthleteProfile(id) {
      const database = await openDatabase(name)
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_ATHLETES], 'readonly')
        const request = transaction.objectStore(STORE_ATHLETES).get(id)
        transaction.oncomplete = () => {
          try {
            resolve(request.result === undefined ? undefined : parseAthleteProfile(request.result))
          } catch (error) {
            reject(asError(error, 'Could not read the athlete profile.'))
          } finally {
            database.close()
          }
        }
        transaction.onabort = () => {
          database.close()
          reject(transactionFailure(transaction, 'Could not read the athlete profile.'))
        }
      })
    },

    async listAthleteProfiles() {
      const database = await openDatabase(name)
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_ATHLETES], 'readonly')
        const request = transaction.objectStore(STORE_ATHLETES).getAll()
        transaction.oncomplete = () => {
          try {
            resolve(sortDescendingByDate(request.result.map(value => parseAthleteProfile(value)), profile => profile.updatedOn))
          } catch (error) {
            reject(asError(error, 'Could not list athlete profiles.'))
          } finally {
            database.close()
          }
        }
        transaction.onabort = () => {
          database.close()
          reject(transactionFailure(transaction, 'Could not list athlete profiles.'))
        }
      })
    },

    async saveWeekPlan(weekPlan) {
      const validated = parseWeekPlan(weekPlan)
      const database = await openDatabase(name)
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_ATHLETES, STORE_WEEKS, STORE_LOGS], 'readwrite')
        const athleteRequest = transaction.objectStore(STORE_ATHLETES).get(validated.athleteId)
        const logsRequest = transaction.objectStore(STORE_LOGS).getAll()
        let failure: Error | undefined
        let athleteReady = false
        let logsReady = false
        const attemptSave = () => {
          if (!athleteReady || !logsReady) return
          try {
            if (athleteRequest.result === undefined) throw new Error(`Week plan ${validated.id} requires an existing athlete profile.`)
            const logs = parseLogs(logsRequest.result ?? [])
            validateWorkoutLogsForWeekPlan(validated, logs.filter(log => log.weekPlanId === validated.id), 'WeekPlan.existingLogs')
            transaction.objectStore(STORE_WEEKS).put(validated)
          } catch (error) {
            failure = asError(error, 'Could not validate the week plan.')
            transaction.abort()
          }
        }
        athleteRequest.onsuccess = () => {
          athleteReady = true
          attemptSave()
        }
        logsRequest.onsuccess = () => {
          logsReady = true
          attemptSave()
        }
        transaction.oncomplete = () => {
          database.close()
          resolve(validated)
        }
        transaction.onabort = () => {
          database.close()
          reject(failure ?? transactionFailure(transaction, 'Could not save the week plan.'))
        }
      })
    },

    async getWeekPlan(id) {
      const database = await openDatabase(name)
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_WEEKS], 'readonly')
        const request = transaction.objectStore(STORE_WEEKS).get(id)
        transaction.oncomplete = () => {
          try {
            resolve(request.result === undefined ? undefined : parseWeekPlan(request.result))
          } catch (error) {
            reject(asError(error, 'Could not read the week plan.'))
          } finally {
            database.close()
          }
        }
        transaction.onabort = () => {
          database.close()
          reject(transactionFailure(transaction, 'Could not read the week plan.'))
        }
      })
    },

    async listWeekPlans(athleteId) {
      const database = await openDatabase(name)
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_WEEKS], 'readonly')
        const request = transaction.objectStore(STORE_WEEKS).getAll()
        transaction.oncomplete = () => {
          try {
            const weeks = request.result.map(value => parseWeekPlan(value))
            const filtered = athleteId === undefined ? weeks : weeks.filter(week => week.athleteId === athleteId)
            resolve(sortDescendingByDate(filtered, week => week.weekStart))
          } catch (error) {
            reject(asError(error, 'Could not list week plans.'))
          } finally {
            database.close()
          }
        }
        transaction.onabort = () => {
          database.close()
          reject(transactionFailure(transaction, 'Could not list week plans.'))
        }
      })
    },

    async getLatestWeekPlan(athleteId) {
      const weeks = await this.listWeekPlans(athleteId)
      return weeks[0]
    },

    async deleteWeekPlan(id) {
      const database = await openDatabase(name)
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_WEEKS, STORE_LOGS], 'readwrite')
        const weekStore = transaction.objectStore(STORE_WEEKS)
        const logStore = transaction.objectStore(STORE_LOGS)
        const logsRequest = logStore.getAll()
        let failure: Error | undefined
        logsRequest.onsuccess = () => {
          try {
            for (const log of parseLogs(logsRequest.result ?? [])) {
              if (log.weekPlanId === id) logStore.delete(log.id)
            }
            weekStore.delete(id)
          } catch (error) {
            failure = asError(error, 'Could not delete the week plan.')
            transaction.abort()
          }
        }
        transaction.oncomplete = () => {
          database.close()
          resolve()
        }
        transaction.onabort = () => {
          database.close()
          reject(failure ?? transactionFailure(transaction, 'Could not delete the week plan.'))
        }
      })
    },

    async saveWorkoutLog(workoutLog) {
      const validated = parseWorkoutLog(workoutLog)
      const database = await openDatabase(name)
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_WEEKS, STORE_LOGS], 'readwrite')
        const weekRequest = transaction.objectStore(STORE_WEEKS).get(validated.weekPlanId)
        const logRequest = transaction.objectStore(STORE_LOGS).get(validated.id)
        let failure: Error | undefined
        let weekReady = false
        let logReady = false
        const attemptSave = () => {
          if (!weekReady || !logReady) return
          try {
            if (weekRequest.result === undefined) throw new Error(`Workout log ${validated.id} requires an existing week plan.`)
            assertLogIdentity(logRequest.result === undefined ? undefined : parseWorkoutLog(logRequest.result), validated)
            validateWorkoutLogsForWeekPlan(parseWeekPlan(weekRequest.result), [validated], 'WorkoutLog')
            transaction.objectStore(STORE_LOGS).put(validated)
          } catch (error) {
            failure = error instanceof Error ? error : new Error('Could not validate the workout log.')
            transaction.abort()
          }
        }
        weekRequest.onsuccess = () => { weekReady = true; attemptSave() }
        logRequest.onsuccess = () => { logReady = true; attemptSave() }
        transaction.oncomplete = () => {
          database.close()
          resolve(validated)
        }
        transaction.onabort = () => {
          database.close()
          reject(failure ?? transactionFailure(transaction, 'Could not save the workout log.'))
        }
      })
    },

    async listWorkoutLogs(query = {}) {
      const database = await openDatabase(name)
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_LOGS], 'readonly')
        const request = transaction.objectStore(STORE_LOGS).getAll()
        transaction.oncomplete = () => {
          try {
            let logs = request.result.map(value => parseWorkoutLog(value))
            if (query.athleteId !== undefined) logs = logs.filter(log => log.athleteId === query.athleteId)
            if (query.weekPlanId !== undefined) logs = logs.filter(log => log.weekPlanId === query.weekPlanId)
            if (query.workoutId !== undefined) logs = logs.filter(log => log.workoutId === query.workoutId)
            resolve(sortDescendingByDate(logs, log => log.loggedOn))
          } catch (error) {
            reject(asError(error, 'Could not list workout logs.'))
          } finally {
            database.close()
          }
        }
        transaction.onabort = () => {
          database.close()
          reject(transactionFailure(transaction, 'Could not list workout logs.'))
        }
      })
    },

    async deleteWorkoutLog(id) {
      const database = await openDatabase(name)
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_LOGS], 'readwrite')
        transaction.objectStore(STORE_LOGS).delete(id)
        transaction.oncomplete = () => {
          database.close()
          resolve()
        }
        transaction.onabort = () => {
          database.close()
          reject(transactionFailure(transaction, 'Could not delete the workout log.'))
        }
      })
    },

    async saveOnboardingDraft(draft) {
      const validated = parseOnboardingDraft(draft)
      const database = await openDatabase(name)
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_DRAFTS], 'readwrite')
        transaction.objectStore(STORE_DRAFTS).put(validated)
        transaction.oncomplete = () => {
          database.close()
          resolve(validated)
        }
        transaction.onabort = () => {
          database.close()
          reject(transactionFailure(transaction, 'Could not save the onboarding draft.'))
        }
      })
    },

    async getOnboardingDraft(id) {
      const database = await openDatabase(name)
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_DRAFTS], 'readonly')
        const request = transaction.objectStore(STORE_DRAFTS).get(id)
        transaction.oncomplete = () => {
          try {
            resolve(request.result === undefined ? undefined : parseOnboardingDraft(request.result))
          } catch (error) {
            reject(asError(error, 'Could not read the onboarding draft.'))
          } finally {
            database.close()
          }
        }
        transaction.onabort = () => {
          database.close()
          reject(transactionFailure(transaction, 'Could not read the onboarding draft.'))
        }
      })
    },

    async listOnboardingDrafts(athleteId) {
      const database = await openDatabase(name)
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_DRAFTS], 'readonly')
        const request = transaction.objectStore(STORE_DRAFTS).getAll()
        transaction.oncomplete = () => {
          try {
            const drafts = request.result.map(value => parseOnboardingDraft(value))
            const filtered = athleteId === undefined ? drafts : drafts.filter(draft => draft.athleteId === athleteId)
            resolve(sortDescendingByDate(filtered, draft => draft.updatedOn))
          } catch (error) {
            reject(asError(error, 'Could not list onboarding drafts.'))
          } finally {
            database.close()
          }
        }
        transaction.onabort = () => {
          database.close()
          reject(transactionFailure(transaction, 'Could not list onboarding drafts.'))
        }
      })
    },

    async deleteOnboardingDraft(id) {
      const database = await openDatabase(name)
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_DRAFTS], 'readwrite')
        transaction.objectStore(STORE_DRAFTS).delete(id)
        transaction.oncomplete = () => {
          database.close()
          resolve()
        }
        transaction.onabort = () => {
          database.close()
          reject(transactionFailure(transaction, 'Could not delete the onboarding draft.'))
        }
      })
    },

    async importWeek(bundle, options = {}) {
      const validated = parseWeekImportBundle(bundle)
      const expectedAthlete = options.expectedAthleteProfile === undefined ? undefined : parseAthleteProfile(options.expectedAthleteProfile)
      if (expectedAthlete && expectedAthlete.id !== validated.weekPlan.athleteId) {
        throw new Error('The previewed athlete must match the imported week.')
      }
      const deletedWorkoutIds = new Set(options.deleteWorkoutIds ?? [])
      if (validated.weekPlan.workouts.some(workout => deletedWorkoutIds.has(workout.id))) {
        throw new Error('Deleted workouts must not remain in the imported week.')
      }
      const database = await openDatabase(name)
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_ATHLETES, STORE_WEEKS, STORE_LOGS], 'readwrite')
        const athleteRequest = transaction.objectStore(STORE_ATHLETES).get(validated.weekPlan.athleteId)
        const logsRequest = transaction.objectStore(STORE_LOGS).getAll()
        let failure: Error | undefined
        let imported = validated
        let athleteReady = false
        let logsReady = false
        const attemptImport = () => {
          if (!athleteReady || !logsReady) return
          try {
            if (athleteRequest.result === undefined && !validated.athleteProfile) {
              throw new Error(`Week import ${validated.weekPlan.id} requires an existing athlete profile.`)
            }
            if (expectedAthlete && (
              athleteRequest.result === undefined
              || JSON.stringify(parseAthleteProfile(athleteRequest.result)) !== JSON.stringify(expectedAthlete)
            )) {
              throw new Error('The athlete profile changed after preview. Preview the week again before applying it.')
            }
            const existingLogs = parseLogs(logsRequest.result ?? [])
            const existingById = new Map(existingLogs.map(log => [log.id, log]))
            for (const log of validated.workoutLogs) assertLogIdentity(existingById.get(log.id), log)
            const isDeletedLog = (log: WorkoutLog) =>
              log.weekPlanId === validated.weekPlan.id && deletedWorkoutIds.has(log.workoutId)
            const combinedLogs = validateWorkoutLogsForWeekPlan(
              validated.weekPlan,
              combineLogs(existingLogs.filter(log => !isDeletedLog(log)), validated.workoutLogs, validated.weekPlan.id),
              'WeekImportBundle.combinedLogs',
            )
            imported = { ...validated, workoutLogs: combinedLogs }
            if (validated.athleteProfile) transaction.objectStore(STORE_ATHLETES).put(validated.athleteProfile)
            transaction.objectStore(STORE_WEEKS).put(validated.weekPlan)
            const logStore = transaction.objectStore(STORE_LOGS)
            for (const log of existingLogs) if (isDeletedLog(log)) logStore.delete(log.id)
            for (const log of validated.workoutLogs) logStore.put(log)
          } catch (error) {
            failure = asError(error, 'Could not validate the week import.')
            transaction.abort()
          }
        }
        athleteRequest.onsuccess = () => {
          athleteReady = true
          attemptImport()
        }
        logsRequest.onsuccess = () => {
          logsReady = true
          attemptImport()
        }
        transaction.oncomplete = () => {
          database.close()
          resolve(imported)
        }
        transaction.onabort = () => {
          database.close()
          reject(failure ?? transactionFailure(transaction, 'Could not import the week plan and logs together.'))
        }
      })
    },

    async exportBackup() {
      const database = await openDatabase(name)
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([...RESETTABLE_STORES], 'readonly')
        const athletes = transaction.objectStore(STORE_ATHLETES).getAll()
        const weeks = transaction.objectStore(STORE_WEEKS).getAll()
        const logs = transaction.objectStore(STORE_LOGS).getAll()
        const drafts = transaction.objectStore(STORE_DRAFTS).getAll()
        transaction.oncomplete = () => {
          try {
            resolve(createBackupEnvelope({
              athleteProfiles: athletes.result.map(value => parseAthleteProfile(value)),
              weekPlans: weeks.result.map(value => parseWeekPlan(value)),
              workoutLogs: logs.result.map(value => parseWorkoutLog(value)),
              onboardingDrafts: drafts.result.map(value => parseOnboardingDraft(value)),
            }))
          } catch (error) {
            reject(asError(error, 'Could not export the local backup.'))
          } finally {
            database.close()
          }
        }
        transaction.onabort = () => {
          database.close()
          reject(transactionFailure(transaction, 'Could not export the local backup.'))
        }
      })
    },

    async restoreBackup(backup) {
      const validated = parseBackupEnvelope(backup)
      const database = await openDatabase(name)
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([...RESETTABLE_STORES], 'readwrite')
        for (const storeName of RESETTABLE_STORES) transaction.objectStore(storeName).clear()
        const athletes = transaction.objectStore(STORE_ATHLETES)
        for (const profile of validated.athleteProfiles) athletes.put(profile)
        const weeks = transaction.objectStore(STORE_WEEKS)
        for (const weekPlan of validated.weekPlans) weeks.put(weekPlan)
        const logs = transaction.objectStore(STORE_LOGS)
        for (const log of validated.workoutLogs) logs.put(log)
        const drafts = transaction.objectStore(STORE_DRAFTS)
        for (const draft of validated.onboardingDrafts) drafts.put(draft)
        transaction.oncomplete = () => {
          database.close()
          resolve(validated)
        }
        transaction.onabort = () => {
          database.close()
          reject(transactionFailure(transaction, 'Could not restore the local backup.'))
        }
      })
    },

    async reset() {
      const database = await openDatabase(name)
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([...RESETTABLE_STORES], 'readwrite')
        for (const storeName of RESETTABLE_STORES) transaction.objectStore(storeName).clear()
        transaction.oncomplete = () => {
          database.close()
          resolve()
        }
        transaction.onabort = () => {
          database.close()
          reject(transactionFailure(transaction, 'Could not reset local training data.'))
        }
      })
    },
  }
}

export function backupSummary(backup: BackupEnvelope): {
  athleteProfiles: number
  weekPlans: number
  workoutLogs: number
  onboardingDrafts: number
} {
  const validated = parseBackupEnvelope(backup)
  return {
    athleteProfiles: validated.athleteProfiles.length,
    weekPlans: validated.weekPlans.length,
    workoutLogs: validated.workoutLogs.length,
    onboardingDrafts: validated.onboardingDrafts.length,
  }
}
