import React, { useRef, useState, useEffect, useCallback, Children, isValidElement, cloneElement } from "react";
import Router from "next/router";

const useIsFirstRender = () => {
  const isFirst = useRef(true);

  if (isFirst.current) {
    isFirst.current = false;
    return true;
  }

  return isFirst.current;
};

export type FormStepComponentProps = {
    currentStep: string | number,
    stepsTotal: number,
    /* @ts-ignore */
    onStepChange: (data: Record<string, any>, disableFormSubmission?: boolean, shouldNavigate?: boolean) => Promise<boolean>,
    /* @ts-ignore */
    onFormChange: (htmlForm: HTMLFormElement, htmlFormValue: { [key: string]: any }) => number;
};

export interface FormStepsWizardProps extends React.HTMLAttributes<HTMLDivElement> {
  initialStepId: string | number;
  steps: Record<string, React.FunctionComponent<FormStepComponentProps>>;
  stepsPathnamePattern: string;
  onStepChangeDiscarded: () => void;
  onStepChange<D extends Record<any, any>>(data: D,  currentStepIndex: number, disableFormSubmission?: boolean): Promise<boolean>;
  onStepChangeError<E extends Error>(error: E): void;
  children?: React.ReactNode | undefined;
  wrapperClassName?: string;
  stepsBoxClassName?: string;
}

const getAllStepPathnames = (
    currentStepId: string | number,
    stepIds: string[],
    stepsPathnamePatternPrefix: string
) => {
  const currentStepIndex = typeof currentStepId === "number"
  ? Math.min(currentStepId, stepIds.length - 1)
  : stepIds.findIndex(stepId => stepId === currentStepId);

  return {
    previousStepPathname: currentStepIndex > 0 
    ? `${stepsPathnamePatternPrefix}#${stepIds[currentStepIndex - 1]}`
    : null,
    currentStepPathname: currentStepIndex >= 0 && currentStepIndex <= stepIds.length - 1
    ? `${stepsPathnamePatternPrefix}#${stepIds[currentStepIndex]}`
    : null,
    nextStepPathname: currentStepIndex < stepIds.length - 1
        ? `${stepsPathnamePatternPrefix}#${stepIds[currentStepIndex + 1]}`
        : null
  };
};

const FormStepsWizard = ({
  initialStepId,
  steps,
  stepsPathnamePattern = "/<folder>/",
  onStepChange,
  onStepChangeDiscarded,
  onStepChangeError,
  children,
  className = "",
  wrapperClassName = "",
  stepsBoxClassName = ""
}: FormStepsWizardProps) => {
    const isFirstRender = useIsFirstRender();

    /* @HINT: Track form change state to know whether to prompt user for unsaved changes */
    const stepsData = useRef<Record<keyof typeof steps, number>>({});
    const stepIds = Object.keys(steps);

    const [currentStepID, setCurrentStepID] = useState(() => {
      typeof initialStepId === "number" 
        ? Math.min(initialStepId, stepIds.length, stepIds.length - 1)
        : initialStepId
    });

    let Step = typeof currentStepID === "number" 
       ? steps[stepIds[Math.min(currentStepID, stepIds.length - 1)]]
       : steps[currentStepID];
    
    const stepsPathnamePrefix = (stepsPathnamePattern.lastIndexOf("/") !== stepsPathnamePattern.length - 1) 
    ? stepsPathnamePattern.substring(
        0,
        stepsPathnamePattern.lastIndexOf("/") + 1
    )
    : stepsPathnamePattern;

    const childrenLength = typeof children === "undefined" ? 0 : Children.toArray(children).length;

    const { previousStepPathname, currentStepPathname, nextStepPathname } = getAllStepPathnames(
        currentStepID,
        stepIds,
        stepsPathnamePrefix
    );

    const onStepChangeTriggered = useCallback(
        (
            data: Record<string, unknown>,
            disableFormSubmission = false,
            navigateToNextStep = true
        ) => {

        const { currentStepPathname, nextStepPathname } = getAllStepPathnames(
            currentStepID, stepIds, stepsPathnamePattern
        );

        if (currentStepPathname !== null) {
            const stepPathnameSuffix = currentStepPathname.replace(
                stepsPathnamePrefix + "#",
                ""
            );
            delete stepsData.current[stepPathnameSuffix];
        }

        return onStepChange<typeof data>(
            data,
            (typeof currentStepID === "number"
            ? Math.min(currentStepID, stepIds.length - 1)
            : stepIds.findIndex(stepId => stepId === currentStepID)),
            disableFormSubmission
        ).then((success: boolean) => {

            if (!success) {
                return false;
            }

            if (navigateToNextStep) {
                if (typeof nextStepPathname === "string") {
                    const [pathname, hash] = nextStepPathname.split("#");
                    return Router.push({
                        pathname,
                        hash
                    }).catch((e) => {
                        /* @NOTE: Inclued a workaround here for dealing with routing errors */
                        /* @CHECK: https://github.com/vercel/next.js/issues/37362 */
                        if (!e.cancelled) {
                          throw e;
                        }
                        return false;
                    });
                } else {
                    setCurrentStepID(
                        typeof currentStepID === "number"
                        ? stepIds.length
                        : currentStepID
                    );
                    return success;
                }
            }

            return success;
        }).catch((error) => {
            if (error instanceof Error) {
                onStepChangeError(error);
            }

            return false;
        });
    }, [currentStepID]);

    const onFormChangeTriggered = useCallback(
        (
            htmlForm: HTMLFormElement,
            htmlFormValues: { [key: string]: any }
        ) => {

        const { currentStepPathname } = getAllStepPathnames(
            currentStepID, stepIds, stepsPathnamePattern
        );
    
        if (currentStepPathname !== null) {
            const stepPathnameSuffix = currentStepPathname.replace(
                stepsPathnamePrefix + "#",
                ""
            );

            let percentFormFilled = stepsData.current[stepPathnameSuffix] || 0;

            const htmlElements = Array.from(htmlForm.elements).filter((element) => {
                return (element.tagName !== "BUTTON" && !element.hasAttribute("disabled"));
            });

            const htmlElementsFilled = Object.keys(htmlFormValues);
      
            percentFormFilled = Math.floor(
                (htmlElementsFilled.length / htmlElements.length) * 100
            );

            stepsData.current[stepPathnameSuffix] = percentFormFilled;

            return percentFormFilled;
        }

        return 0;

    }, [currentStepID]);

    useEffect(() => {

        const handleHashChangeStart = () => {
            const { currentStepPathname } = getAllStepPathnames(
                currentStepID, stepIds, stepsPathnamePattern
            );
            if (currentStepPathname !== null) {
                let [ , stepPathnameSuffix ] = currentStepPathname.split("#");
                const value = stepsData.current[stepPathnameSuffix];

                if (!Number.isNaN(value) && value <= 100) {
                    if (value > 0) {
                        const canDiscardChanges = window.confirm(
                            "Are you sure you wish to discard unsaved changes ?"
                        );
        
                        if (!canDiscardChanges) {
                            if (!window.location.href.endsWith(stepPathnameSuffix)) {
                                window.location.assign(
                                    `${window.location.href.replace(
                                        /\b\#(?:[a-zA-Z_-]+)/, ""
                                    )}#${stepPathnameSuffix}`
                                );
                            }
                            throw 'Abort discarding unsaved changes';
                        } else {
                            onStepChangeDiscarded();
                        }
                    }
                }
            }
        };
        
        const handleHashChangeComplete = (destinationUrl: string) => {

            if (typeof window !== "undefined") {
                window.scrollTo(0, 0);
            }

            const hasStepPathnamePattern = destinationUrl.indexOf("#") === -1 && destinationUrl.endsWith(
                stepsPathnamePattern.substring(0, stepsPathnamePattern.length - 1)
            );

            const stepPathnameSuffix = hasStepPathnamePattern ? stepIds[0] : destinationUrl.substring(
                destinationUrl.indexOf("#") + 1
            );

            if (!stepsData.current[stepPathnameSuffix]) {
                stepsData.current[stepPathnameSuffix] = 0;
            }

            setCurrentStepID(
                typeof currentStepID === "number"
                ? stepIds.findIndex(stepId => stepId === stepPathnameSuffix)
                : stepPathnameSuffix
            );
        };

        Router.events.on("hashChangeStart", handleHashChangeStart);
        Router.events.on("hashChangeComplete", handleHashChangeComplete);

        return () => {
            Router.events.off("hashChangeStart", handleHashChangeStart);
            Router.events.off("hashChangeComplete", handleHashChangeComplete);
        };
    }, [currentStepID]);

    useEffect(() => {

        window.onhashchange = (e: HashChangeEvent) => {
            const [, pageHash ] = e.newURL.split("#");
    
            if (!stepsData.current[pageHash]) {
                stepsData.current[pageHash] = 0;
            }

            if (typeof pageHash === "string") {
                const currentStepId = stepIds.indexOf(
                    pageHash
                );
                if (currentStepId !== -1
                    && currentStepID !== currentStepId) {
                    setCurrentStepID(currentStepId);
                }
            }  
        };

        return () => {
            window.onhashchange = null;
        }
    
    }, []);

    /* @NOTE:
        I couldn't find a NextJS official way to add a hash to a
        page URL or pathname as soon as it has loaded per the docs
        So, this is a temporary work-around till Vercel supplies
        an official way to do this in the docs and the canary.
    */
    if (isFirstRender) {
        if (typeof window !== "undefined") {
            const pageHash = window.location.hash;
            if (pageHash === "" || pageHash === "#") {
                const stepPathnameSuffix = typeof initialStepId === "number"
                    ? stepIds[Math.min(initialStepId, stepIds.length, stepIds.length - 1)]
                    : initialStepId;

                window.location.replace(
                `${window.location.href.replace(
                    /\b\#(?:[a-zA-Z_-]+)/, ""
                )}#${stepPathnameSuffix}`
                );
            }
        }
    }


    return (
      <div className={wrapperClassName}>
        <section className={className} data-has-children={JSON.stringify(childrenLength > 0)}>
          {childrenLength > 0 ?
              Children.map(children, ( child ) => {
                  if (!isValidElement(child)) {
                      return null;
                  }
  
                  /* @NOTE: A bug with Typescript declarations for React v18.x causing problems here */
                  /* @CHECK: https://github.com/DefinitelyTyped/DefinitelyTyped/issues/62222 */
                  return cloneElement(child as React.ReactElement, {
                      stepIds,
                      currentStepIndex: typeof currentStepID === "number"
                      ? currentStepID
                      : stepIds.findIndex(stepId => stepId === currentStepID),
                      paths: {
                          previousStepPathname,
                          currentStepPathname,
                          nextStepPathname
                      }
                  })
              })
              : null
          }
        </section>

        <section className={stepsBoxClassName}>
          <Step
            currentStep={typeof currentStepID === "number" ? Math.min(currentStepID + 1, stepIds.length) : currentStepID}
            stepsTotal={stepIds.length}
            onFormChange={onFormChangeTriggered} /* @HINT: Setup to trigger when `onChange` and `onReset` is triggered */
            onStepChange={onStepChangeTriggered}
          />
        </section>
      </div>
    );
};

export default FormStepsWizard;
