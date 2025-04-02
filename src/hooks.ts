type StorageTypes = string | object;

type JSObject = { [key: string]: unknown };

type JSONObject<D = JSObject> =
  | object
  | Record<keyof D, string | boolean | number | null | undefined>;

type SerializableValues<D = object> =
  | string
  | number
  | boolean
  | null
  | undefined
  | JSONObject<D>;

interface BrowserStorage {
  getFromStorage<T extends SerializableValues>(
    key: string,
    defaultPayload?: T
  ): T;
  setToStorage: (key: string, value: SerializableValues) => boolean;
  clearFromStorage: (key: string) => boolean;
}

type BrowserStorageOptions = {
  enableEncryption: boolean;
  storageType: "session" | "local";
};

const encrypt = <O extends JSObject>(value: SerializableValues<O>): string => {
  return JSON.stringify(value);
};

const decrypt = <O extends JSObject>(value: string): SerializableValues<O> => {
  return JSON.parse(value);
};

export const useBrowserStorage = ({
  enableEncryption = false,
  storageType = "session",
}: BrowserStorageOptions): BrowserStorage => {
  return {
    setToStorage: (
      key: string,
      value = null as SerializableValues
    ): boolean => {
      /* 
        @HINT: 
      
        This is the side-effect for each state change cycle - we want to write to
        `localStorage` | `sessionStorage`
      */
      if (typeof window !== "undefined") {
        const storageDriver =
          storageType === "session" ? sessionStorage : localStorage;
        try {
          if (!enableEncryption) {
            if (value !== null) {
              if (typeof key === "string") {
                storageDriver.setItem(
                  key,
                  typeof value === "string" || typeof value === "number"
                    ? "" + value
                    : JSON.stringify(value)
                );
                return true;
              }
            }
          } else {
            if (value !== null) {
              if (typeof key === "string") {
                storageDriver.setItem(key, encrypt(value));
                return true;
              }
            }
          }
        } catch (error) {
          const storageError = error as Error;
          if (storageError.name === "QuotaExceededError") {
            return false;
          }
        }
      }
      return false;
    },
    clearFromStorage: (key = "") => {
      /* @HINT: As the component unmounts, we want to delete from `localStorage` | `sessionStorage` */
      if (typeof window !== "undefined") {
        const storageDriver =
          storageType === "session" ? sessionStorage : localStorage;
        try {
          storageDriver.removeItem(key);
        } catch (_) {
          return false;
        }
        return true;
      }
      return false;
    },
    getFromStorage(key: string, defaultPayload?: SerializableValues) {
      /* @HINT: We want to fetch from `localStorage` | `sessionStorage` */
      let stringifiedPayload = null;

      try {
        if (typeof window !== "undefined") {
          const storageDriver =
            storageType === "session" ? sessionStorage : localStorage;
          stringifiedPayload = storageDriver.getItem(key);
          if (
            stringifiedPayload === null &&
            typeof defaultPayload !== "undefined"
          ) {
            storageDriver.setItem(
              key,
              typeof defaultPayload === "string"
                ? defaultPayload
                : String(defaultPayload)
            );
          }
        }
      } catch (error) {
        const storageError = error as Error;
        if (storageError.name === "SecurityError") {
          stringifiedPayload = null;
        }
      }

      if (!enableEncryption) {
        let payload = null;
        try {
          payload = !stringifiedPayload
            ? defaultPayload
            : JSON.parse(stringifiedPayload);
        } catch (e) {
          const error = e as Error;
          payload = defaultPayload;
          if (error.name === "SyntaxError") {
            if (stringifiedPayload !== null) {
              payload = stringifiedPayload;
            }
          }
        }
        return payload;
      } else {
        let payload = defaultPayload;

        if (stringifiedPayload !== null) {
          payload = decrypt(stringifiedPayload);
        }
        return payload;
      }
    },
  };
};

const useBeforePageUnload = (
  callback = (target: Window | EventTarget | null) => undefined,
  { when = false, message = "", extraWatchProperty = "" }
) => {
  React.useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      callback(event.target);

      window.removeEventListener("beforeunload", handleBeforeUnload);

      if (message !== "") {
        /* @ts-ignore */
        event.returnValue = message;
        return message;
      } else {
        /* @ts-ignore */
        event.returnValue = undefined;
        return;
      }
    }

    if (when) {
      window.addEventListener("beforeunload", handleBeforeUnload);
    }

    return () => {
      if (when) {
        window.removeEventListener("beforeunload", handleBeforeUnload);
      }
    };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [when, message, extraWatchProperty]);
};

const useBrowserStorageEffectUpdates = <
  T extends StorageTypes | undefined | null
>(
  storageKey: string,
  storageDefaultValue: T,
  storageType?: BrowserStorageOptions["storageType"],
  storageMode?: "bypassEffect" | "enforceEffect"
) => {
  const mode = typeof storageMode === "string" ? storageMode : "enforceEffect";
  const { setToStorage, getFromStorage, clearFromStorage } = useBrowserStorage({
    storageType:
      storageType ||
      "local" /* @HINT: makes use of `window.localStorage` by default */,
    enableEncryption: false /* @HINT: No encryption of data */,
  });
  const [storageValueUpdate, setStorageValueUpdate] = React.useState<T>(() => {
    return mode === "bypassEffect"
      ? storageDefaultValue
      : getFromStorage<T>(storageKey, storageDefaultValue);
  });

  useBeforePageUnload(
    () => {
      const isClosed = window.closed;

      setTimeout(() => {
        if (isClosed || !window || window.closed) {
          clearFromStorage(storageKey);
        }
      }, 0);

      return undefined;
    },
    { when: !!storageKey, message: "", extraWatchProperty: storageKey }
  );

  React.useEffect(() => {
    if (mode === "enforceEffect") {
      setToStorage(storageKey, storageValueUpdate);
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [JSON.stringify(storageValueUpdate), storageKey, mode]);

  const setNextUpdateToStorage = (
    nextStorageValueUpdate: T,
    { append = false } = {}
  ) => {
    setStorageValueUpdate((previousStorageValue: T) => {
      let currentStorageValue = "";

      if (typeof storageValueUpdate !== "string") {
        currentStorageValue = JSON.stringify(nextStorageValueUpdate);
      } else {
        currentStorageValue = nextStorageValueUpdate as string;
      }

      if (JSON.stringify(previousStorageValue) === currentStorageValue) {
        return previousStorageValue;
      }

      if (append) {
        const freshStorageValue =
          mode === "bypassEffect"
            ? previousStorageValue
            : getFromStorage<T | undefined | null>(storageKey);

        if (
          freshStorageValue &&
          nextStorageValueUpdate &&
          typeof nextStorageValueUpdate === "object" &&
          typeof freshStorageValue === "object"
        ) {
          const newerStorageValue =
            Array.isArray(nextStorageValueUpdate) &&
            Array.isArray(freshStorageValue)
              ? (freshStorageValue.concat(nextStorageValueUpdate) as T)
              : (Object.assign(freshStorageValue, nextStorageValueUpdate) as T);

          if (
            JSON.stringify(freshStorageValue) ===
            JSON.stringify(newerStorageValue)
          ) {
            return previousStorageValue;
          }

          return newerStorageValue;
        }
      }

      return nextStorageValueUpdate;
    });
  };

  return [storageValueUpdate, setNextUpdateToStorage, getFromStorage] as const;
};

export const useFormWizardSteps = (formStepsLastId: string, defaultStepId = "0") => {
  const [currentStepId, setCurrentStepId] = useBrowserStorageEffectUpdates<string>("$__formSteps", defaultStepId);
  return [currentStepId, setCurrentStepId] as const;
};
