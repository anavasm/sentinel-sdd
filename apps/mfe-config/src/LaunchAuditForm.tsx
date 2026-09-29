/**
 * Audit launch form (US-2): controlled fields validated fail-fast against the
 * contract rules (src/lib/auditForm.ts) before any network call; server
 * rejections arrive as RFC 9457 Problems whose `errors[]` are bound back onto
 * the matching inputs (US2-AC3). While the POST is in flight the whole form is
 * inert against double-submission (US2-AC4).
 */
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiProblemError, type Severity } from '@sentinel/contracts';

import {
  buildAuditConfigPayload,
  SEVERITY_OPTIONS,
  toFieldErrorsFromProblem,
  validateAuditFormValues,
  type AuditFormErrors,
  type AuditFormValues,
} from './lib/auditForm';
import { launchAudit } from './lib/auditApi';

const RULE_SET_CHECKBOXES: readonly { readonly key: keyof AuditFormValues['ruleSets']; readonly label: string }[] = [
  { key: 'owaspTop10', label: 'OWASP Top 10' },
  { key: 'testQuality', label: 'Test Quality' },
  { key: 'codeSmellsPerformance', label: 'Code Smells & Performance' },
];

const INITIAL_FORM_VALUES: AuditFormValues = {
  repoSourceMode: 'git',
  repoUrl: '',
  localPath: '',
  ruleSets: { owaspTop10: true, testQuality: false, codeSmellsPerformance: false },
  severityThreshold: 'MEDIUM',
};

export function LaunchAuditForm(): JSX.Element {
  const [formValues, setFormValues] = useState<AuditFormValues>(INITIAL_FORM_VALUES);
  const [fieldErrors, setFieldErrors] = useState<AuditFormErrors>({});
  const [formLevelError, setFormLevelError] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const repoUrlInputId = useId();
  const localPathInputId = useId();
  const severitySelectId = useId();

  function updateFormValues(partialValues: Partial<AuditFormValues>): void {
    setFormValues({ ...formValues, ...partialValues });
  }

  function updateRuleSet(ruleSetKey: keyof AuditFormValues['ruleSets'], isEnabled: boolean): void {
    updateFormValues({ ruleSets: { ...formValues.ruleSets, [ruleSetKey]: isEnabled } });
  }

  async function handleSubmit(submitEvent: FormEvent<HTMLFormElement>): Promise<void> {
    submitEvent.preventDefault();

    // Fail fast: never issue the POST for a config the backend must reject.
    const validationErrors = validateAuditFormValues(formValues);
    setFieldErrors(validationErrors);
    setFormLevelError(undefined);
    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      const auditCreated = await launchAudit(buildAuditConfigPayload(formValues));
      navigate(`/audits/${auditCreated.auditId}`);
    } catch (submitError: unknown) {
      if (submitError instanceof ApiProblemError) {
        setFieldErrors(toFieldErrorsFromProblem(submitError.problem.errors));
        setFormLevelError(submitError.problem.detail ?? submitError.problem.title ?? 'Audit launch failed.');
      } else {
        setFormLevelError('Audit launch failed - the API is unreachable or returned an unexpected error.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      className="mt-6 space-y-6 rounded-lg border border-slate-700 bg-sentinel-panel p-6"
      noValidate
      aria-label="Audit launch"
      onSubmit={(submitEvent) => {
        void handleSubmit(submitEvent);
      }}
    >
      {formLevelError !== undefined && (
        <p role="alert" className="rounded border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-300">
          {formLevelError}
        </p>
      )}

      <fieldset className="space-y-4" disabled={isSubmitting}>
        <legend className="text-sm font-semibold uppercase tracking-wide text-slate-400">Repository source</legend>

        <div className="flex gap-4 text-sm text-slate-200">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="repoSourceMode"
              value="git"
              className={choiceInputClassName}
              checked={formValues.repoSourceMode === 'git'}
              disabled={isSubmitting}
              onChange={() => updateFormValues({ repoSourceMode: 'git' })}
            />
            Git URL
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="repoSourceMode"
              value="local"
              className={choiceInputClassName}
              checked={formValues.repoSourceMode === 'local'}
              disabled={isSubmitting}
              onChange={() => updateFormValues({ repoSourceMode: 'local' })}
            />
            Local path
          </label>
        </div>

        {formValues.repoSourceMode === 'git' ? (
          <FormField label="Repository URL" htmlFor={repoUrlInputId} {...optionalErrorProp(fieldErrors.repoUrl)}>
            <input
              id={repoUrlInputId}
              name="repoUrl"
              type="text"
              className={formControlClassName(fieldErrors.repoUrl !== undefined)}
              placeholder="https://github.com/example/repo.git"
              value={formValues.repoUrl}
              disabled={isSubmitting}
              onChange={(changeEvent) => updateFormValues({ repoUrl: changeEvent.target.value })}
            />
          </FormField>
        ) : (
          <FormField label="Local path" htmlFor={localPathInputId} {...optionalErrorProp(fieldErrors.localPath)}>
            <input
              id={localPathInputId}
              name="localPath"
              type="text"
              className={formControlClassName(fieldErrors.localPath !== undefined)}
              placeholder="/Users/dev/projects/sample-repo"
              value={formValues.localPath}
              disabled={isSubmitting}
              onChange={(changeEvent) => updateFormValues({ localPath: changeEvent.target.value })}
            />
          </FormField>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold uppercase tracking-wide text-slate-400">Rule sets</legend>
        <FormFieldError {...optionalErrorProp(fieldErrors.ruleSets)} />
        {RULE_SET_CHECKBOXES.map((ruleSetCheckbox) => (
          <label key={ruleSetCheckbox.key} className="flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              name={ruleSetCheckbox.key}
              className={choiceInputClassName}
              checked={formValues.ruleSets[ruleSetCheckbox.key]}
              disabled={isSubmitting}
              onChange={(changeEvent) => updateRuleSet(ruleSetCheckbox.key, changeEvent.target.checked)}
            />
            {ruleSetCheckbox.label}
          </label>
        ))}
      </fieldset>

      <FormField label="Severity threshold" htmlFor={severitySelectId} {...optionalErrorProp(fieldErrors.severityThreshold)}>
        <select
          id={severitySelectId}
          name="severityThreshold"
          className={formControlClassName(fieldErrors.severityThreshold !== undefined)}
          value={formValues.severityThreshold}
          disabled={isSubmitting}
          onChange={(changeEvent) => updateFormValues({ severityThreshold: changeEvent.target.value as Severity })}
        >
          {SEVERITY_OPTIONS.map((severityOption) => (
            <option key={severityOption} value={severityOption}>
              {severityOption}
            </option>
          ))}
        </select>
      </FormField>

      <button
        type="submit"
        className="flex items-center justify-center rounded bg-sentinel-accent px-4 py-2 text-sm font-semibold text-slate-950 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-sentinel-accent focus:ring-offset-2 focus:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isSubmitting}
      >
        {isSubmitting ? 'Launching...' : 'Launch audit'}
      </button>
    </form>
  );
}

interface FormFieldProps {
  readonly label: string;
  readonly htmlFor: string;
  readonly error?: string;
  readonly children: ReactNode;
}

function FormField({ label, htmlFor, error, children }: FormFieldProps): JSX.Element {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-300">
        {label}
      </label>
      {children}
      <FormFieldError {...optionalErrorProp(error)} />
    </div>
  );
}

function optionalErrorProp(error: string | undefined): { error?: string } {
  return error === undefined ? {} : { error };
}

function FormFieldError({ error }: { readonly error?: string }): JSX.Element | null {
  if (error === undefined) {
    return null;
  }
  return (
    <p role="alert" className="text-xs text-red-300">
      {error}
    </p>
  );
}

/**
 * Shared Tailwind utilities for every block-level control (text inputs,
 * select) so the form keeps one visual contract: dark surface, slate border,
 * accent focus ring, red border while a field error is displayed.
 */
function formControlClassName(hasError: boolean): string {
  const baseClassName =
    'w-full rounded border bg-slate-900 px-3 py-2 text-sm text-slate-100 '
    + 'border-slate-700 focus:outline-none focus:ring-2 focus:ring-sentinel-accent '
    + 'disabled:cursor-not-allowed disabled:opacity-50';
  return hasError ? `${baseClassName} border-red-500` : baseClassName;
}

/** Compact utilities for radio/checkbox inputs inside flex label rows. */
const choiceInputClassName =
  'h-4 w-4 rounded border-slate-700 bg-slate-900 text-sentinel-accent '
  + 'focus:outline-none focus:ring-2 focus:ring-sentinel-accent disabled:cursor-not-allowed disabled:opacity-50';
