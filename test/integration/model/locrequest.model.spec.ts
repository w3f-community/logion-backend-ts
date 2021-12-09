import moment from "moment";
import { connect, executeScript, disconnect, checkNumOfRows } from "../../helpers/testdb";
import {
    LocRequestAggregateRoot,
    LocRequestRepository,
    FetchLocRequestsSpecification,
    LocFile,
    LocMetadataItem,
    LocLink
} from "../../../src/logion/model/locrequest.model";
import { ALICE, BOB } from "../../../src/logion/model/addresses.model";
import { v4 as uuid } from "uuid";

describe('LocRequestRepository - read accesses', () => {

    beforeAll(async () => {
        await connect([ LocRequestAggregateRoot, LocFile, LocMetadataItem, LocLink ]);
        await executeScript("test/integration/model/loc_requests.sql");
        repository = new LocRequestRepository();
    });

    let repository: LocRequestRepository;

    afterAll(async () => {
        await disconnect();
    });

    it("find by owner and status", async () => {
        const query: FetchLocRequestsSpecification = {
            expectedOwnerAddress: ALICE,
            expectedStatuses: [ "OPEN", "REQUESTED" ],
        }
        const requests = await repository.findBy(query);
        checkDescription(requests, "loc-1", "loc-2", "loc-4", "loc-5", "loc-10");

        expect(requests[0].getDescription().userIdentity).toBeUndefined();
    })

    it("find by requester and status", async () => {
        const query: FetchLocRequestsSpecification = {
            expectedRequesterAddress: "5CXLTF2PFBE89tTYsrofGPkSfGTdmW4ciw4vAfgcKhjggRgZ",
            expectedStatuses: [ "REJECTED" ],
        }
        const requests = await repository.findBy(query);
        checkDescription(requests, "loc-7")

        expect(requests[0].getDescription().requesterAddress).toBe("5CXLTF2PFBE89tTYsrofGPkSfGTdmW4ciw4vAfgcKhjggRgZ");
        expect(requests[0].getDescription().ownerAddress).toBe("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY");
        expect(requests[0].getDescription().userIdentity).toEqual({
            firstName: 'John',
            lastName: 'Doe',
            email: 'john.doe@logion.network',
            phoneNumber: '+123456'
        });
        expect(requests[0].status).toBe("REJECTED");
    })

    it("finds loc with files, metadata and links", async () => {
        const request = await repository.findById(LOC_WITH_FILES);
        checkDescription([request!], "loc-10");

        const hash = "0x1307990e6ba5ca145eb35e99182a9bec46531bc54ddf656a602c780fa0240dee";
        expect(request!.hasFile(hash)).toBe(true);
        const file = request!.getFile(hash);
        expect(file.name).toBe("a file");
        expect(file.hash).toBe(hash);
        expect(file.oid).toBe(123456);
        expect(file.addedOn!.isSame(moment("2021-10-06T11:16:00.000"))).toBe(true);
        expect(file.nature).toBe("some nature")
        expect(request!.files![0].draft).toBe(true);

        const metadata = request!.getMetadataItems();
        expect(metadata.length).toBe(1);
        expect(metadata[0].name).toBe("a name");
        expect(metadata[0].value).toBe("a value");
        expect(metadata[0].addedOn!.isSame(moment("2021-10-06T11:16:00.000"))).toBe(true);
        expect(request!.metadata![0].draft).toBe(true);

        const links = request!.getLinks();
        expect(links.length).toBe(1);
        expect(links[0].target).toBe("ec126c6c-64cf-4eb8-bfa6-2a98cd19ad5d");
        expect(links[0].addedOn!.isSame(moment("2021-10-06T11:16:00.000"))).toBe(true);
        expect(links[0].nature).toBe("link-nature")
        expect(request!.links![0].draft).toBe(true);
    })

})

describe('LocRequestRepository.save()', () => {

    beforeAll(async () => {
        await connect([ LocRequestAggregateRoot, LocFile, LocMetadataItem, LocLink ]);
        repository = new LocRequestRepository();
    });

    let repository: LocRequestRepository;

    afterAll(async () => {
        await disconnect();
    });

    it("saves a LocRequest aggregate", async () => {
        const id = '57104fa2-18b2-4a0a-a23b-f907deadc2de'
        const locRequest = givenOpenLoc(id)

        await repository.save(locRequest)

        await checkAggregate(id, 1)
    })

    it("rollbacks when trying to add invalid link", async () => {
        const id = '12940aa1-12f5-463f-b39c-c2902ccdfd25'
        const locRequest = givenOpenLoc(id)

        locRequest.links![0].target = undefined;

        const result: string = await repository.save(locRequest)
            .catch((reason => {
                return reason.toString()
            }))
        expect(result).toBe("QueryFailedError: null value in column \"target\" violates not-null constraint")

        await checkAggregate(id, 0)
    })
})

function givenOpenLoc(id: string): LocRequestAggregateRoot {
    const locRequest = new LocRequestAggregateRoot();
    locRequest.id = id;
    locRequest.requesterAddress = "5CXLTF2PFBE89tTYsrofGPkSfGTdmW4ciw4vAfgcKhjggRgZ"
    locRequest.ownerAddress = BOB
    locRequest.description = "I want to open a case"
    locRequest.locType = "Transaction"
    locRequest.createdOn = moment().toISOString()
    locRequest.status = 'OPEN'

    locRequest.links = []
    locRequest.addLink({
        target: uuid(),
        nature: "link nature",
        addedOn: moment()
    })
    locRequest.files = []
    locRequest.addFile({
        name: "fileName",
        addedOn: moment(),
        hash: "hash",
        oid: 123,
        contentType: "content/type",
        nature: "nature1",
    })
    locRequest.metadata = []
    locRequest.addMetadataItem({
        name: "itemName",
        addedOn: moment(),
        value: "something valuable"
    })
    return locRequest;
}

async function checkAggregate(id: string, numOfRows: number) {
    await checkNumOfRows(`SELECT *
                          FROM loc_request
                          WHERE id = '${ id }'`, numOfRows)
    await checkNumOfRows(`SELECT *
                          FROM loc_link
                          WHERE request_id = '${ id }'`, numOfRows)
    await checkNumOfRows(`SELECT *
                          FROM loc_metadata_item
                          WHERE request_id = '${ id }'`, numOfRows)
    await checkNumOfRows(`SELECT *
                          FROM loc_request_file
                          WHERE request_id = '${ id }'`, numOfRows)
}

function checkDescription(requests: LocRequestAggregateRoot[], ...descriptions: string[]) {
    expect(requests.length).toBe(descriptions.length);
    descriptions.forEach(description => {
        const matchingRequests = requests.filter(request => request.getDescription().description === description);
        expect(matchingRequests.length).withContext(`loc with description ${ description } not returned by query`).toBe(1);
        expect(matchingRequests[0].locType).toBe('Transaction');
    })
}

const LOC_WITH_FILES = "2b287596-f9d5-8030-b606-d1da538cb37f";
