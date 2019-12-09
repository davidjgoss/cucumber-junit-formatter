/** Based on json_formater from cucumber module */
import _ from 'lodash';
import {GherkinDocumentParser, PickleParser,formatLocation} from 'cucumber/lib/formatter/helpers'; // eslint-disable-line sort-imports
import Formatter from 'cucumber/lib/formatter';
import Status from 'cucumber/lib/status';
import {buildStepArgumentIterator} from 'cucumber/lib/step_arguments';
import {format} from 'assertion-error-formatter';
const utils=require("../util");
const ToXML=require("./scenarios");
// const {scenarioAsStep,scenarioAsSuite}=require("./scenarios");


const {getStepLineToKeywordMap,getScenarioLineToDescriptionMap} = GherkinDocumentParser;

const {
  getScenarioDescription,
  getStepLineToPickledStepMap,
  getStepKeyword
} = PickleParser;

const getScenarioData=({ pickle, scenarioLineToDescriptionMap })=>{
    const description = getScenarioDescription({
        pickle,
        scenarioLineToDescriptionMap
    });
    return {
        description,
        id: `${utils.convertNameToId(pickle.name)}`,
        keyword: 'Scenario',
        line: pickle.locations[0].line,
        name: pickle.name,
        tags: utils.getTags(pickle),
        type: 'scenario'
    };
};


export default class JsonFormatter extends Formatter {
    constructor(options) {
        super(options);
//        this.features2xml=options.scenarioAsStep?scenarioAsStep:scenarioAsSuite;
        options.eventBroadcaster.on('test-run-finished', ()=>this.onTestRunFinished());
        this._toXML=new ToXML(options);
    }

    /** Format step arguments
     * @param {Object} stepArgumetns
     * @return {Object}
     */
    formatStepArguments(stepArguments) {
        const iterator = buildStepArgumentIterator({
            dataTable: utils.formatDataTable.bind(this),
            docString: utils.formatDocString.bind(this)
        });
        return _.map(stepArguments, iterator);
    }

    /** On test run event handler */
    onTestRunFinished() {
        const groupedTestCaseAttempts = {};
        _.each(this.eventDataCollector.getTestCaseAttempts(), testCaseAttempt=>{
            if (!testCaseAttempt.result.retried) {
                const { uri } = testCaseAttempt.testCase.sourceLocation;
                if (!groupedTestCaseAttempts[uri]) {
                    groupedTestCaseAttempts[uri] = [];
                }
                groupedTestCaseAttempts[uri].push(testCaseAttempt);
            }
        });
        const features = _.map(groupedTestCaseAttempts, (group, uri)=>{
            const gherkinDocument = this.eventDataCollector.gherkinDocumentMap[uri];
            const featureData = utils.getFeatureData(gherkinDocument.feature, uri);
            const stepLineToKeywordMap = getStepLineToKeywordMap(gherkinDocument);
            const scenarioLineToDescriptionMap = getScenarioLineToDescriptionMap(gherkinDocument);
            featureData.elements = group.map(testCaseAttempt=>{
                const {pickle} = testCaseAttempt;
                const scenarioData = getScenarioData({
                    featureId: featureData.id,
                    pickle,
                    scenarioLineToDescriptionMap
                });
                const stepLineToPickledStepMap = getStepLineToPickledStepMap(pickle);
                let isBeforeHook = true;
                scenarioData.steps = testCaseAttempt.testCase.steps.map((testStep, index)=>{
                    isBeforeHook = isBeforeHook && !testStep.sourceLocation;
                    return this.getStepData({
                        isBeforeHook,
                        stepLineToKeywordMap,
                        stepLineToPickledStepMap,
                        testStep,
                        testStepAttachments: testCaseAttempt.stepAttachments[index],
                        testStepResult: testCaseAttempt.stepResults[index]
                    });
                });
                return scenarioData;
            });
            return featureData;
         });
        this.log(this._toXML.generateXML(features));
//        this.log(JSON.stringify(features, null, 2));

    }



    getStepData({isBeforeHook,stepLineToKeywordMap,stepLineToPickledStepMap,testStep,testStepAttachments,testStepResult}) {
        const data = {};
        if (testStep.sourceLocation) {
            const {line} = testStep.sourceLocation;
            const pickleStep = stepLineToPickledStepMap[line];
            data.arguments = this.formatStepArguments(pickleStep.arguments);
            data.keyword = getStepKeyword({pickleStep, stepLineToKeywordMap});
            data.line = line;
            data.name = pickleStep.text;
        } else {
            data.keyword = isBeforeHook ? 'Before' : 'After';
            data.hidden = true;
        }
        if (testStep.actionLocation) {
            data.match = {location: formatLocation(testStep.actionLocation)};
        }
        data.result={failures:0,errors:0,skipped:0};
        if (testStepResult) {
            const {exception,status} = testStepResult;
            data.result = {...{status},...data.result};
            if (!_.isUndefined(testStepResult.duration)) {
                data.result.duration = testStepResult.duration;
            }
            switch(status) {
                case Status.PASSED:
                    break;
                case Status.FAILED:
                    if (testStep.sourceLocation){
                        data.result.failures+=1;
                    }
                    else {
                        data.result.errors+=1;
                    }
                    if (exception) {
                        let {name}=exception;
                        data.result.error_name = name; // eslint-disable-line camelcase
                        data.result.error_message = format(exception); // eslint-disable-line camelcase
                    }
                    break;
                case Status.PENDING:
                        data.result.failures+=1;
                        data.result.error_message = 'Pending'; // eslint-disable-line camelcase
                        data.result.error_name = 'Pending'; // eslint-disable-line camelcase
                        break;
                case Status.UNDEFINED:
                    data.result.failures+=1;
                    data.result.error_message = `Undefined step. Implement with the following snippet:\n  ${data.keyword.trim()}(/^${data.name}$/, function(callback) {\n      // Write code here that turns the phrase above into concrete actions\n      callback(null, 'pending');\n  });`; // eslint-disable-line camelcase
                    data.result.error_name = data.result.error_message.split("\n").shift(); // eslint-disable-line camelcase
                    break;
                case Status.SKIPPED:
                    data.result.skipped+=1;
                    break;
                case Status.AMBIGUOUS:
                    data.result.errors+=1;
                    if (exception) {
                        data.result.error_message = format(exception); // eslint-disable-line camelcase
                    }
                    break;

                default:
                    break;
                //
            }
        }
        if (_.size(testStepAttachments) > 0) {
            data.embeddings = testStepAttachments.map(
                attachment=>({
                    data: attachment.data,
                    mime_type: attachment.media.type // eslint-disable-line camelcase
                })
            );
        }
        return data;
    }

}